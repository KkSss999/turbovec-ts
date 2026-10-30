import { performance } from 'node:perf_hooks';

import { TurboQuantIndex as WrappedIndex } from '../index.js';
import { TurboQuantIndex as NativeIndex } from '../native.js';

interface IndexHandle {
  add(vectors: Float32Array): Promise<void>;
  search(queries: Float32Array, k: number): Promise<{ scores: Float32Array }>;
}

type IndexConstructor = new (dim: number, bitWidth: number) => IndexHandle;

const dim = 1536;
const n = 10_000;
const nq = 100;
const k = 10;
const runs = 7;

function fillRandom(target: Float32Array): void {
  for (let i = 0; i < target.length; i += 1) {
    target[i] = Math.random() - 0.5;
  }
}

const vectors = new Float32Array(dim * n);
const queries = new Float32Array(dim * nq);
fillRandom(vectors);
fillRandom(queries);

async function build(Index: IndexConstructor): Promise<IndexHandle> {
  const index = new Index(dim, 4);
  await index.add(vectors);
  return index;
}

async function searchOnce(index: IndexHandle): Promise<number> {
  const start = performance.now();
  const result = await index.search(queries, k);
  const elapsed = performance.now() - start;
  // Keep the result observable so the work is not discarded.
  if ((result.scores[0] ?? 0) === Number.POSITIVE_INFINITY) throw new Error('unexpected');
  return elapsed;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const native = await build(NativeIndex);
const wrapped = await build(WrappedIndex);

// Warm both paths before timing.
await searchOnce(native);
await searchOnce(wrapped);

const nativeTimes: number[] = [];
const wrappedTimes: number[] = [];

for (let run = 0; run < runs; run += 1) {
  if (run % 2 === 0) {
    nativeTimes.push(await searchOnce(native));
    wrappedTimes.push(await searchOnce(wrapped));
  } else {
    wrappedTimes.push(await searchOnce(wrapped));
    nativeTimes.push(await searchOnce(native));
  }
}

const nativeMedian = median(nativeTimes);
const wrappedMedian = median(wrappedTimes);

console.log(
  JSON.stringify({
    dim,
    n,
    nq,
    k,
    nativeSearchMs: Number(nativeMedian.toFixed(2)),
    wrappedSearchMs: Number(wrappedMedian.toFixed(2)),
    wrapperOverheadPct: Number((((wrappedMedian - nativeMedian) / nativeMedian) * 100).toFixed(2)),
  }),
);
