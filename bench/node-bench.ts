import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

import { TurboQuantIndex } from '../index.js';

interface Args {
  vectors: string;
  queries: string;
  groundtruth: string;
  dim: number;
  n: number;
  nq: number;
  k: number;
  bits: number;
  repeats: number;
  backpressure: boolean;
}

function parseArgs(): Args {
  const args: Args = {
    vectors: '',
    queries: '',
    groundtruth: '',
    dim: 768,
    n: 20_000,
    nq: 100,
    k: 10,
    bits: 4,
    repeats: 5,
    backpressure: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`missing value for ${flag}`);
      i += 1;
      return next;
    };
    switch (flag) {
      case '--vectors':
        args.vectors = value();
        break;
      case '--queries':
        args.queries = value();
        break;
      case '--groundtruth':
        args.groundtruth = value();
        break;
      case '--dim':
        args.dim = Number(value());
        break;
      case '--n':
        args.n = Number(value());
        break;
      case '--nq':
        args.nq = Number(value());
        break;
      case '--k':
        args.k = Number(value());
        break;
      case '--bits':
        args.bits = Number(value());
        break;
      case '--repeats':
        args.repeats = Number(value());
        break;
      case '--backpressure':
        args.backpressure = true;
        break;
      default:
        throw new Error(`unknown argument ${flag}`);
    }
  }
  if (!args.vectors || !args.queries || !args.groundtruth) {
    throw new Error('--vectors, --queries, and --groundtruth are required');
  }
  return args;
}

function readF32(path: string): Float32Array {
  const buffer = readFileSync(path);
  if (buffer.byteOffset % 4 !== 0) throw new Error(`${path} is not f32-aligned`);
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

function readU32(path: string): Uint32Array {
  const buffer = readFileSync(path);
  if (buffer.byteOffset % 4 !== 0) throw new Error(`${path} is not u32-aligned`);
  return new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function mb(bytes: number): number {
  return bytes / 1024 / 1024;
}

function recall(groundtruth: Uint32Array, found: number[], nq: number, k: number): number {
  let hits = 0;
  for (let qi = 0; qi < nq; qi += 1) {
    const expected = new Set<number>();
    for (let j = 0; j < k; j += 1) expected.add(groundtruth[qi * k + j] ?? -1);
    for (let j = 0; j < k; j += 1) {
      if (expected.has(found[qi * k + j] ?? -1)) hits += 1;
    }
  }
  return hits / (nq * k);
}

function recallAt1(groundtruth: Uint32Array, found: number[], nq: number, k: number): number {
  let hits = 0;
  for (let qi = 0; qi < nq; qi += 1) {
    if (found[qi * k] === groundtruth[qi * k]) hits += 1;
  }
  return hits / nq;
}

async function runPool(concurrency: number, count: number, fn: (index: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= count) return;
      await fn(index);
    }
  });
  await Promise.all(workers);
}

async function measureBackpressure(index: TurboQuantIndex, queries: Float32Array, args: Args) {
  const levels = [1, 2, 4, 8, 16, 32, 64];
  const requests = 64;
  const monitor = monitorEventLoopDelay({ resolution: 10 });
  const rows = [];

  for (const concurrency of levels) {
    for (let i = 0; i < 8; i += 1) {
      await index.search(
        queries.subarray((i % args.nq) * args.dim, ((i % args.nq) + 1) * args.dim),
        1,
      );
    }
    monitor.reset();
    monitor.enable();
    const latencies: number[] = [];
    const start = performance.now();
    await runPool(concurrency, requests, async (i) => {
      const qi = i % args.nq;
      const begin = performance.now();
      await index.search(queries.subarray(qi * args.dim, (qi + 1) * args.dim), 1);
      latencies.push(performance.now() - begin);
    });
    const wallMs = performance.now() - start;
    monitor.disable();
    rows.push({
      concurrency,
      requests,
      wallMs,
      qps: requests / (wallMs / 1000),
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      p99Ms: percentile(latencies, 99),
      maxMs: Math.max(...latencies),
      eventLoopP50Ms: monitor.percentile(50) / 1e6,
      eventLoopP99Ms: monitor.percentile(99) / 1e6,
      eventLoopMaxMs: monitor.max / 1e6,
    });
  }
  return rows;
}

async function main() {
  const args = parseArgs();
  const memBefore = process.memoryUsage();
  let vectors = readF32(args.vectors);
  const queries = readF32(args.queries);
  const groundtruth = readU32(args.groundtruth);
  if (vectors.length !== args.n * args.dim) throw new Error('vector shape mismatch');
  if (queries.length !== args.nq * args.dim) throw new Error('query shape mismatch');
  if (groundtruth.length !== args.nq * args.k) throw new Error('groundtruth shape mismatch');

  const buildStart = performance.now();
  const index = new TurboQuantIndex(args.dim, args.bits);
  await index.add(vectors);
  const sampleRows = Math.min(args.n, 1024);
  await index.calibrate(vectors.subarray(0, sampleRows * args.dim));
  await index.prepare();
  const buildMs = performance.now() - buildStart;
  const memAfterBuild = process.memoryUsage();
  const estimatedBytes = index.estimatedBytes;
  const serializedBytes = index.serializedLength;

  // Release the raw corpus before measuring the resident index footprint.
  vectors = new Float32Array(0);
  const gc = Reflect.get(globalThis, 'gc');
  if (typeof gc === 'function') {
    gc();
    await new Promise((resolve) => setImmediate(resolve));
    gc();
  }
  const memAfterRelease = process.memoryUsage();

  await index.search(queries, args.k);
  await index.search(queries, args.k);
  const times: number[] = [];
  let result = await index.search(queries, args.k);
  for (let run = 0; run < args.repeats; run += 1) {
    const start = performance.now();
    result = await index.search(queries, args.k);
    times.push(performance.now() - start);
  }
  const searchMs = median(times);
  const recallAtK = recall(groundtruth, result.indices, args.nq, result.k);
  const recall1 = recallAt1(groundtruth, result.indices, args.nq, result.k);

  const backpressure = args.backpressure
    ? await measureBackpressure(index, queries, args)
    : undefined;

  console.log(
    JSON.stringify(
      {
        impl: 'node',
        runtime: process.version,
        threads: Number(process.env.RAYON_NUM_THREADS ?? availableParallelism()),
        uvThreadpoolSize: Number(process.env.UV_THREADPOOL_SIZE ?? 4),
        dim: args.dim,
        n: args.n,
        nq: args.nq,
        k: result.k,
        bits: args.bits,
        repeats: args.repeats,
        buildMs,
        searchBatchMs: searchMs,
        perQueryMs: searchMs / args.nq,
        qps: args.nq / (searchMs / 1000),
        recallAtK,
        recallAt1: recall1,
        rssBeforeMb: mb(memBefore.rss),
        rssAfterBuildMb: mb(memAfterBuild.rss),
        rssAfterReleaseMb: mb(memAfterRelease.rss),
        peakRssMb: process.resourceUsage().maxRSS / 1024,
        arrayBuffersAfterBuildMb: mb(memAfterBuild.arrayBuffers),
        arrayBuffersAfterReleaseMb: mb(memAfterRelease.arrayBuffers),
        heapUsedAfterReleaseMb: mb(memAfterRelease.heapUsed),
        serializedBytes,
        estimatedIndexBytes: estimatedBytes,
        backpressure,
      },
      null,
      2,
    ),
  );
  index.dispose();
}

await main();
