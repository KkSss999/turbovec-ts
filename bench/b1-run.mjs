import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { TurboQuantIndex } from '../index.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CACHE = join(ROOT, 'bench/.cache');
const RESULTS = join(ROOT, 'bench/results');

const shapes = {
  quick: { n: 20_000, dim: 768, nq: 100, k: 10, repeats: 20, single: 100 },
  full: { n: 100_000, dim: 1536, nq: 100, k: 64, repeats: 5, single: 50 },
};

function fillRandom(target, seed) {
  let state = seed >>> 0;
  for (let i = 0; i < target.length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    target[i] = (state >>> 0) / 4_294_967_296 - 0.5;
  }
}

function normalizeRows(values, dim) {
  for (let row = 0; row < values.length; row += dim) {
    let sum = 0;
    for (let i = 0; i < dim; i += 1) sum += values[row + i] ** 2;
    const inverse = 1 / Math.sqrt(sum);
    for (let i = 0; i < dim; i += 1) values[row + i] *= inverse;
  }
}

function data(shape) {
  mkdirSync(CACHE, { recursive: true });
  const base = join(CACHE, `b1-${shape.n}-${shape.dim}-${shape.nq}`);
  const vectorsPath = `${base}.f32`;
  const queriesPath = `${base}.queries.f32`;
  const vectors = new Float32Array(shape.n * shape.dim);
  fillRandom(vectors, 0x51ed2701);
  normalizeRows(vectors, shape.dim);
  writeFileSync(vectorsPath, Buffer.from(vectors.buffer));
  const queries = new Float32Array(shape.nq * shape.dim);
  fillRandom(queries, 0x9e3779b9);
  normalizeRows(queries, shape.dim);
  writeFileSync(queriesPath, Buffer.from(queries.buffer));
  return { vectors, queries, vectorsPath, queriesPath };
}

function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function percentile(values, p) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function parseLines(text) {
  const result = {};
  for (const line of text.trim().split(/\r?\n/)) {
    const [key, value] = line.split('=');
    result[key] = Number(value);
  }
  return result;
}

async function coldStart(dim, bits, samples = 5) {
  const times = [];
  for (let i = 0; i < samples; i += 1) {
    const start = performance.now();
    const index = new TurboQuantIndex(dim, bits);
    await index.stats();
    times.push(performance.now() - start);
    await index.close();
  }
  return times;
}

async function runSidecar(shape, dataset) {
  const cold = await coldStart(shape.dim, 4);
  const index = new TurboQuantIndex(shape.dim, 4);
  await index.stats();

  let start = performance.now();
  await index.add(dataset.vectors);
  const addMs = performance.now() - start;

  const single = [];
  const query = dataset.queries.subarray(0, shape.dim);
  for (let i = 0; i < 10; i += 1) await index.search(query, shape.k);
  for (let i = 0; i < shape.single; i += 1) {
    const begin = performance.now();
    await index.search(query, shape.k);
    single.push(performance.now() - begin);
  }

  const batch = [];
  for (let i = 0; i < 3; i += 1) await index.search(dataset.queries, shape.k);
  for (let i = 0; i < shape.repeats; i += 1) {
    const begin = performance.now();
    await index.search(dataset.queries, shape.k);
    batch.push(performance.now() - begin);
  }
  const stats = await index.stats();
  await index.close();

  return {
    coldStartMs: median(cold),
    addMs,
    singleP50Ms: percentile(single, 50),
    singleP95Ms: percentile(single, 95),
    singleP99Ms: percentile(single, 99),
    singleQps: 1000 / median(single),
    batchP50Ms: median(batch),
    batchQps: shape.nq / (median(batch) / 1000),
    stats,
  };
}

function runCore(shape, dataset) {
  execFileSync('cargo', ['build', '--release', '--example', 'core_bench'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  const output = execFileSync(
    join(ROOT, 'target/release/examples/core_bench'),
    [
      '--vectors',
      dataset.vectorsPath,
      '--queries',
      dataset.queriesPath,
      '--dim',
      String(shape.dim),
      '--nq',
      String(shape.nq),
      '--k',
      String(shape.k),
      '--repeats',
      String(shape.repeats),
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return parseLines(output);
}

function report(results, shape) {
  const lines = [
    `## ${shape.name} (${shape.n} x ${shape.dim}, k=${shape.k})`,
    '',
    '| metric | B1 sidecar | direct core |',
    '|---|---:|---:|',
    `| cold start (median) | ${results.sidecar.coldStartMs.toFixed(1)} ms | n/a |`,
    `| add | ${results.sidecar.addMs.toFixed(1)} ms | ${results.core.add_ms.toFixed(1)} ms |`,
    `| single query p50 | ${results.sidecar.singleP50Ms.toFixed(3)} ms | ${results.core.single_p50_ms.toFixed(3)} ms |`,
    `| single query p99 | ${results.sidecar.singleP99Ms.toFixed(3)} ms | ${results.core.single_p99_ms.toFixed(3)} ms |`,
    `| single query QPS | ${results.sidecar.singleQps.toFixed(0)} | ${results.core.single_qps.toFixed(0)} |`,
    `| ${shape.nq}-query batch p50 | ${results.sidecar.batchP50Ms.toFixed(2)} ms | ${results.core.batch_p50_ms.toFixed(2)} ms |`,
    `| ${shape.nq}-query batch QPS | ${results.sidecar.batchQps.toFixed(0)} | ${results.core.batch_qps.toFixed(0)} |`,
    '',
    `sidecar stats: ${JSON.stringify(results.sidecar.stats)}`,
    '',
  ];
  return lines.join('\n');
}

const requested = process.argv.includes('--full') ? ['quick', 'full'] : ['quick'];
const all = [];
for (const name of requested) {
  const shape = { name, ...shapes[name] };
  console.log(`running ${name}...`);
  const dataset = data(shape);
  const sidecar = await runSidecar(shape, dataset);
  const core = runCore(shape, dataset);
  const result = { shape, sidecar, core };
  all.push(result);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, `b1-${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
}
const reportText = `# B1 benchmark\n\nGenerated ${new Date().toISOString().slice(0, 10)} on \`${process.platform}/${process.arch}\`.\n\nB1 is the packaged JS client + Rust sidecar. Direct core is the in-process Rust baseline on the same raw data. This measures the package boundary, not recall or a server.\n\n${all.map((row) => report(row, row.shape)).join('\n')}\n## Caveats\n\n- The sidecar uses the package-owned framed stdio transport.\n- The direct core baseline has no IPC, process startup, or Node runtime.\n- Single-query sidecar numbers include process round-trips; batch numbers include one round-trip per batch.\n- Only Linux x64 is collected by this script. Windows x64 must be run separately.\n- Synthetic normalized vectors are a regression signal, not a production recall claim.\n`;
writeFileSync(join(ROOT, 'docs/benchmarks.md'), reportText);
console.log('wrote docs/benchmarks.md');
