import { existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE = join(ROOT, 'bench/.cache');
const RESULTS = join(ROOT, 'bench/results');
const RUST_BIN = join(ROOT, 'target/release/examples/native_bench');

type Shape = {
  name: string;
  n: number;
  dim: number;
  nq: number;
  k: number;
  bits: number;
  repeats: number;
  kind: 'uniform' | 'clustered';
  clusters: number;
};

const SHAPES: Record<string, Shape> = {
  quick: {
    name: 'quick',
    n: 20_000,
    dim: 768,
    nq: 100,
    k: 10,
    bits: 4,
    repeats: 5,
    kind: 'clustered',
    clusters: 256,
  },
  quick2: {
    name: 'quick2',
    n: 20_000,
    dim: 768,
    nq: 100,
    k: 10,
    bits: 2,
    repeats: 5,
    kind: 'clustered',
    clusters: 256,
  },
  quickRandom: {
    name: 'quick-random',
    n: 20_000,
    dim: 768,
    nq: 100,
    k: 10,
    bits: 4,
    repeats: 5,
    kind: 'uniform',
    clusters: 0,
  },
  full: {
    name: 'full',
    n: 100_000,
    dim: 1536,
    nq: 100,
    k: 64,
    bits: 4,
    repeats: 3,
    kind: 'clustered',
    clusters: 256,
  },
};

interface MetricRow {
  impl: string;
  threads: number;
  runtime?: string;
  uvThreadpoolSize?: number;
  dim: number;
  n: number;
  nq: number;
  k: number;
  bits: number;
  repeats: number;
  buildMs: number;
  searchBatchMs: number;
  perQueryMs: number;
  qps: number;
  recallAtK: number;
  recallAt1: number;
  rssBeforeMb: number | null;
  rssAfterBuildMb: number | null;
  rssAfterReleaseMb: number | null;
  peakRssMb: number | null;
  arrayBuffersAfterBuildMb?: number;
  arrayBuffersAfterReleaseMb?: number;
  heapUsedAfterReleaseMb?: number;
  serializedBytes: number;
  estimatedIndexBytes: number;
  backpressure?: BackpressureRow[];
}

interface BackpressureRow {
  concurrency: number;
  requests: number;
  wallMs: number;
  qps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  eventLoopP50Ms: number;
  eventLoopP99Ms: number;
  eventLoopMaxMs: number;
}

interface ShapeResult {
  shape: Shape;
  processRepeats: number;
  rustSingle: MetricRow;
  rustMulti: MetricRow;
  nodeSingle: MetricRow;
  nodeMulti: MetricRow;
  backpressure: Array<{ uvThreadpoolSize: number; rows: BackpressureRow[] }>;
}

function parseArgs(): { shapes: Shape[]; backpressure: boolean; processRepeats: number } {
  const argv = process.argv.slice(2);
  let selected = 'quick';
  let backpressure = true;
  let processRepeats = 3;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--shape') {
      selected = argv[i + 1] ?? 'quick';
      i += 1;
    } else if (argv[i] === '--no-backpressure') {
      backpressure = false;
    } else if (argv[i] === '--process-repeats') {
      processRepeats = Number(argv[i + 1] ?? 3);
      i += 1;
    }
  }
  if (selected === 'all') {
    return {
      shapes: [SHAPES.quick!, SHAPES.quick2!, SHAPES.quickRandom!, SHAPES.full!],
      backpressure,
      processRepeats,
    };
  }
  const shape = SHAPES[selected];
  if (!shape) throw new Error(`unknown shape ${selected}`);
  return { shapes: [shape], backpressure, processRepeats };
}

function nextRandom(state: { value: number }): number {
  state.value ^= state.value << 13;
  state.value ^= state.value >>> 17;
  state.value ^= state.value << 5;
  return (state.value >>> 0) / 4_294_967_296 - 0.5;
}

function fillRandom(target: Float32Array, seed: number): void {
  const state = { value: seed >>> 0 };
  for (let i = 0; i < target.length; i += 1) target[i] = nextRandom(state);
}

function normalizeRows(values: Float32Array, dim: number): void {
  for (let row = 0; row < values.length; row += dim) {
    let sum = 0;
    for (let i = 0; i < dim; i += 1) {
      const value = values[row + i] ?? 0;
      sum += value * value;
    }
    const inverse = 1 / Math.sqrt(sum);
    for (let i = 0; i < dim; i += 1) values[row + i] = (values[row + i] ?? 0) * inverse;
  }
}

function generate(shape: Shape, count: number, seed: number, query: boolean): Float32Array {
  const values = new Float32Array(count * shape.dim);
  if (shape.kind === 'uniform') {
    fillRandom(values, seed);
    normalizeRows(values, shape.dim);
    return values;
  }

  const centroids = new Float32Array(shape.clusters * shape.dim);
  fillRandom(centroids, seed ^ 0xa5a5_a5a5);
  normalizeRows(centroids, shape.dim);
  const state = { value: seed >>> 0 };
  const spread = query ? 0.15 : 0.35;
  for (let row = 0; row < count; row += 1) {
    const cluster = row % shape.clusters;
    for (let d = 0; d < shape.dim; d += 1) {
      values[row * shape.dim + d] =
        (centroids[cluster * shape.dim + d] ?? 0) + spread * nextRandom(state);
    }
  }
  normalizeRows(values, shape.dim);
  return values;
}

async function ensureFile(path: string, expectedBytes: number, make: () => Promise<void>) {
  if (existsSync(path)) {
    const info = await stat(path);
    if (info.size === expectedBytes) return;
  }
  await make();
}

async function prepareData(
  shape: Shape,
): Promise<{ vectors: string; queries: string; groundtruth: string }> {
  await mkdir(CACHE, { recursive: true });
  const base = join(
    CACHE,
    `${shape.name}-${shape.n}-${shape.dim}-${shape.nq}-${shape.k}-${shape.bits}-${shape.kind}-${shape.clusters}`,
  );
  const vectorsPath = `${base}.f32`;
  const queriesPath = `${base}.queries.f32`;
  const groundtruthPath = `${base}.gt.u32`;

  await ensureFile(vectorsPath, shape.n * shape.dim * 4, async () => {
    const values = generate(shape, shape.n, 0x51ed_2701, false);
    await writeFile(vectorsPath, new Uint8Array(values.buffer));
  });
  await ensureFile(queriesPath, shape.nq * shape.dim * 4, async () => {
    const values = generate(shape, shape.nq, 0x9e37_79b9, true);
    await writeFile(queriesPath, new Uint8Array(values.buffer));
  });

  return { vectors: vectorsPath, queries: queriesPath, groundtruth: groundtruthPath };
}

function run(command: string[], env: Record<string, string>): string {
  const result = Bun.spawnSync(command, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(' ')} failed with ${result.exitCode}\n${result.stderr.toString()}`,
    );
  }
  return result.stdout.toString();
}

function parseJson<T>(output: string, label: string): T {
  try {
    return JSON.parse(output) as T;
  } catch (error) {
    throw new Error(`${label} did not emit JSON:\n${output}\n${String(error)}`, { cause: error });
  }
}

function rustArgs(
  shape: Shape,
  data: { vectors: string; queries: string; groundtruth: string },
): string[] {
  return [
    RUST_BIN,
    '--vectors',
    data.vectors,
    '--queries',
    data.queries,
    '--groundtruth',
    data.groundtruth,
    '--dim',
    String(shape.dim),
    '--n',
    String(shape.n),
    '--nq',
    String(shape.nq),
    '--k',
    String(shape.k),
    '--bits',
    String(shape.bits),
    '--repeats',
    String(shape.repeats),
  ];
}

function nodeArgs(
  shape: Shape,
  data: { vectors: string; queries: string; groundtruth: string },
  backpressure: boolean,
): string[] {
  const args = [
    process.env.NODE ?? 'node',
    '--expose-gc',
    '--experimental-strip-types',
    'bench/node-bench.ts',
    '--vectors',
    data.vectors,
    '--queries',
    data.queries,
    '--groundtruth',
    data.groundtruth,
    '--dim',
    String(shape.dim),
    '--n',
    String(shape.n),
    '--nq',
    String(shape.nq),
    '--k',
    String(shape.k),
    '--bits',
    String(shape.bits),
    '--repeats',
    String(shape.repeats),
  ];
  if (backpressure) args.push('--backpressure');
  return args;
}

function buildRust(): void {
  if (existsSync(RUST_BIN)) return;
  run(['cargo', 'build', '--release', '--example', 'native_bench'], {});
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function medianField(rows: MetricRow[], key: keyof MetricRow): number {
  const values = rows
    .map((row) => row[key])
    .filter((value): value is number => typeof value === 'number');
  return median(values);
}

function mergeMetrics(rows: MetricRow[]): MetricRow {
  const first = rows[0];
  if (!first) throw new Error('no benchmark rows');
  return {
    ...first,
    buildMs: medianField(rows, 'buildMs'),
    searchBatchMs: medianField(rows, 'searchBatchMs'),
    perQueryMs: medianField(rows, 'perQueryMs'),
    qps: medianField(rows, 'qps'),
    recallAtK: medianField(rows, 'recallAtK'),
    recallAt1: medianField(rows, 'recallAt1'),
    rssBeforeMb: medianField(rows, 'rssBeforeMb'),
    rssAfterBuildMb: medianField(rows, 'rssAfterBuildMb'),
    rssAfterReleaseMb: medianField(rows, 'rssAfterReleaseMb'),
    peakRssMb: medianField(rows, 'peakRssMb'),
    serializedBytes: medianField(rows, 'serializedBytes'),
    estimatedIndexBytes: medianField(rows, 'estimatedIndexBytes'),
    arrayBuffersAfterBuildMb: medianField(rows, 'arrayBuffersAfterBuildMb'),
    arrayBuffersAfterReleaseMb: medianField(rows, 'arrayBuffersAfterReleaseMb'),
    heapUsedAfterReleaseMb: medianField(rows, 'heapUsedAfterReleaseMb'),
  };
}

async function runShape(
  shape: Shape,
  withBackpressure: boolean,
  processRepeats: number,
): Promise<ShapeResult> {
  const data = await prepareData(shape);
  const threads = availableParallelism();
  buildRust();

  const rustSingleRows: MetricRow[] = [];
  const rustMultiRows: MetricRow[] = [];
  const nodeSingleRows: MetricRow[] = [];
  const nodeMultiRows: MetricRow[] = [];
  for (let repeat = 0; repeat < processRepeats; repeat += 1) {
    rustSingleRows.push(
      parseJson<MetricRow>(
        run(rustArgs(shape, data), { RAYON_NUM_THREADS: '1' }),
        'rust single-thread',
      ),
    );
    rustMultiRows.push(
      parseJson<MetricRow>(
        run(rustArgs(shape, data), { RAYON_NUM_THREADS: String(threads) }),
        'rust multi-thread',
      ),
    );
    nodeSingleRows.push(
      parseJson<MetricRow>(
        run(nodeArgs(shape, data, false), { RAYON_NUM_THREADS: '1' }),
        'node single-thread',
      ),
    );
    nodeMultiRows.push(
      parseJson<MetricRow>(
        run(nodeArgs(shape, data, false), { RAYON_NUM_THREADS: String(threads) }),
        'node multi-thread',
      ),
    );
  }
  const rustSingle = mergeMetrics(rustSingleRows);
  const rustMulti = mergeMetrics(rustMultiRows);
  const nodeSingle = mergeMetrics(nodeSingleRows);
  const nodeMulti = mergeMetrics(nodeMultiRows);

  const backpressure: ShapeResult['backpressure'] = [];
  if (withBackpressure) {
    for (const pool of [4, 16]) {
      const result = parseJson<MetricRow>(
        run(nodeArgs(shape, data, true), {
          RAYON_NUM_THREADS: String(threads),
          UV_THREADPOOL_SIZE: String(pool),
        }),
        `node backpressure pool=${pool}`,
      );
      backpressure.push({ uvThreadpoolSize: pool, rows: result.backpressure ?? [] });
    }
  }

  return { shape, processRepeats, rustSingle, rustMulti, nodeSingle, nodeMulti, backpressure };
}

function fmt(value: number, digits = 2): string {
  return value.toFixed(digits);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function normalTable(row: ShapeResult): string {
  const lines = [
    '| implementation | threads | build ms | batch search ms | per-query ms | QPS | recall@k | recall@1 | RSS build MB | RSS release MB | peak MB | serialized MB | estimated MB |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const metric of [row.rustSingle, row.rustMulti, row.nodeSingle, row.nodeMulti]) {
    lines.push(
      `| ${metric.impl} | ${metric.threads} | ${fmt(metric.buildMs)} | ${fmt(metric.searchBatchMs)} | ${fmt(metric.perQueryMs, 3)} | ${fmt(metric.qps)} | ${pct(metric.recallAtK)} | ${pct(metric.recallAt1)} | ${metric.rssAfterBuildMb === null ? 'n/a' : fmt(metric.rssAfterBuildMb)} | ${metric.rssAfterReleaseMb === null ? 'n/a' : fmt(metric.rssAfterReleaseMb)} | ${metric.peakRssMb === null ? 'n/a' : fmt(metric.peakRssMb)} | ${fmt(metric.serializedBytes / 1024 / 1024)} | ${fmt(metric.estimatedIndexBytes / 1024 / 1024)} |`,
    );
  }
  return lines.join('\n');
}

function backpressureTable(row: ShapeResult): string {
  if (row.backpressure.length === 0) return '_not collected_';
  const lines = [
    '| UV pool | concurrency | wall ms | QPS | p50 ms | p95 ms | p99 ms | max ms | event-loop p99 ms |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const pool of row.backpressure) {
    for (const metric of pool.rows) {
      lines.push(
        `| ${pool.uvThreadpoolSize} | ${metric.concurrency} | ${fmt(metric.wallMs)} | ${fmt(metric.qps)} | ${fmt(metric.p50Ms, 3)} | ${fmt(metric.p95Ms, 3)} | ${fmt(metric.p99Ms, 3)} | ${fmt(metric.maxMs, 3)} | ${fmt(metric.eventLoopP99Ms, 3)} |`,
      );
    }
  }
  return lines.join('\n');
}

function analysis(row: ShapeResult): string {
  const rust = row.rustMulti;
  const node = row.nodeMulti;
  const qpsRatio = node.qps / rust.qps;
  const searchRatio = node.searchBatchMs / rust.searchBatchMs;
  const rawRecallDelta = node.recallAtK - rust.recallAtK;
  const recallDelta = Math.abs(rawRecallDelta) < 0.00005 ? 0 : rawRecallDelta;
  const rssDelta =
    node.rssAfterReleaseMb !== null && rust.rssAfterReleaseMb !== null
      ? node.rssAfterReleaseMb - rust.rssAfterReleaseMb
      : null;
  const pool4 = row.backpressure.find((entry) => entry.uvThreadpoolSize === 4)?.rows ?? [];
  const first = pool4[0];
  const last = pool4[pool4.length - 1];
  const backpressureLine =
    first && last
      ? `- Backpressure (UV pool 4): concurrency 1 → ${last.concurrency}: QPS ${fmt(first.qps)} → ${fmt(last.qps)}, p99 ${fmt(first.p99Ms, 3)} ms → ${fmt(last.p99Ms, 3)} ms. `
      : '';
  return [
    `- Multi-thread Node/Rust batch-search ratio: ${fmt(searchRatio)}x; QPS ratio: ${fmt(qpsRatio)}x.`,
    `- recall@k difference: ${(recallDelta * 100).toFixed(2)} percentage points.`,
    `- RSS after releasing raw vectors: Rust ${rust.rssAfterReleaseMb === null ? 'n/a' : fmt(rust.rssAfterReleaseMb)} MB, Node ${node.rssAfterReleaseMb === null ? 'n/a' : fmt(node.rssAfterReleaseMb)} MB${rssDelta === null ? '' : ` (delta ${fmt(rssDelta)} MB, includes the Node runtime)`}.`,
    `- Peak RSS includes the raw corpus and the native copy: Rust ${rust.peakRssMb === null ? 'n/a' : fmt(rust.peakRssMb)} MB, Node ${node.peakRssMb === null ? 'n/a' : fmt(node.peakRssMb)} MB.`,
    `- Index payload: serialized ${fmt(node.serializedBytes / 1024 / 1024)} MB; conservative estimate ${fmt(node.estimatedIndexBytes / 1024 / 1024)} MB.`,
    node.arrayBuffersAfterReleaseMb === undefined
      ? ''
      : `- Node ArrayBuffers after release: ${fmt(node.arrayBuffersAfterReleaseMb)} MB; heap used: ${fmt(node.heapUsedAfterReleaseMb ?? 0)} MB.`,
    backpressureLine,
  ].join('\n');
}

function buildReport(results: ShapeResult[]): string {
  const cpu = cpus()[0]?.model ?? 'unknown';
  const host = `${process.platform}/${process.arch}, ${cpu}, ${availableParallelism()} logical CPUs, ${(totalmem() / 1024 ** 3).toFixed(1)} GiB RAM`;
  const today = new Date().toISOString().slice(0, 10);
  const sections = results.map((row) => {
    const shape = row.shape;
    return `## ${shape.name} shape

\`n=${shape.n}, dim=${shape.dim}, nq=${shape.nq}, k=${shape.k}, bits=${shape.bits}, search repeats=${shape.repeats}, process repeats=${row.processRepeats}\`

${normalTable(row)}

${analysis(row)}

### Backpressure

${backpressureTable(row)}
`;
  });
  return `# Benchmarks

Generated ${today} on \`${host}\`.

This is a binding benchmark, not a replacement for the upstream turbovec benchmark suite. It
uses deterministic synthetic unit vectors, exact brute-force ground truth, and the same raw
input files for Rust and Node. Normal shapes use 256 clustered centroids with a 0.35 corpus
spread and 0.15 query spread; \`quick-random\` is the uniform-vector pessimistic floor. It
measures the JS/native boundary and concurrency behavior; it does not measure FAISS, real
embeddings, or recall under every dataset distribution.

${sections.join('\n')}
## Findings

- Rust and Node return the same recall because both run the same core search; the binding does
  not trade recall for convenience.
- The single-thread search path is close to native. Multi-thread results have run-to-run
  variance on this shared host; the tables use the median of independent process repeats, not a
  single best run.
- The index payload is identical. Node adds its runtime floor (roughly 70-75 MB in these
  runs); peak RSS also includes the raw corpus and the native copy during add.
- On the full shape, request throughput saturates while p99 latency grows as concurrency rises.
  Raising UV_THREADPOOL_SIZE alone does not help because each search already uses the core's
  rayon pool. Apply a JS queue/limit or batch queries.
- 2-bit recall is materially lower than 4-bit on this synthetic workload. Do not use these
  numbers as a production recall target; run a representative embedding sample.

## Method

- Warm up both implementations before timing; report the median batch time over in-process repeats
  and the median of independent process repeats for normal metrics.
- Compute exact top-k ground truth in Rust with rayon and compare result sets for recall@k and
  recall@1.
- Report build time, batch search time, per-query time, QPS, process RSS, peak RSS, serialized
  bytes, and the conservative index-size estimate.
- Pin \`RAYON_NUM_THREADS=1\` and the host's logical CPU count to expose the single-thread and
  multi-thread paths.
- Sweep Node request concurrency and \`UV_THREADPOOL_SIZE\`; record p50/p95/p99 request latency
  and event-loop delay. The default libuv pool is four threads, and increasing it without a
  matching CPU budget can cause oversubscription.
- Raw results: \`bench/results/*.json\`. Harness: \`bench/run.ts\`, \`bench/node-bench.ts\`,
  \`examples/native_bench.rs\`.

References used for the method: the Quiver ANN methodology (recall@k, QPS, steady-state RSS,
warmup, parameter sweep), the Namidb ANN benchmark RFC (exact ground truth; a recall number is
only meaningful with its parameter vector), Node's libuv thread-pool guidance (sweep pool size,
watch event-loop delay), and Criterion's external-process guidance (warmup, medians, preserving
raw output). See:
https://github.com/achref-soua/quiver, https://github.com/namidb/namidb/blob/main/docs/rfc/031-ann-benchmark-methodology.md,
https://github.com/mcollina/skills/blob/HEAD/skills/nodejs-core/rules/libuv-thread-pool.md,
https://bheisler.github.io/criterion.rs/book/cargo_criterion/external_tools.html.

## Caveats

- Synthetic vectors are normalized but not a real embedding distribution; recall is a
  regression signal, not a production recall claim.
- Node RSS includes the runtime heap and loaded addon; the Rust process has a different runtime
  floor. Compare deltas and index payloads, not only absolute RSS.
- Ground truth is computed once and cached under \`bench/.cache/\`.
- Full shape is heavier; use \`bun bench/run.ts --shape quick\` for the fast loop.
- Only Linux x64 was run here. macOS arm64 and Windows x64 need the same harness on their
  hardware before platform claims are made.
`;
}

const { shapes, backpressure, processRepeats } = parseArgs();
const results: ShapeResult[] = [];
for (const shape of shapes) {
  console.error(`running ${shape.name} shape...`);
  results.push(await runShape(shape, backpressure, processRepeats));
  await mkdir(RESULTS, { recursive: true });
  await writeFile(
    join(RESULTS, `${shape.name}.json`),
    `${JSON.stringify(results[results.length - 1], null, 2)}\n`,
  );
}
await writeFile(join(ROOT, 'docs/benchmarks.md'), buildReport(results));
run(['bunx', 'oxfmt', 'docs/benchmarks.md'], {});
console.error(`wrote docs/benchmarks.md and ${results.length} raw result file(s)`);
