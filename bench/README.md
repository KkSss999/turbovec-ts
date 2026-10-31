# Binding benchmark suite

This compares the Node binding against the Rust core on the same raw input files. It is a
binding/overhead and concurrency harness, not a replacement for the upstream turbovec benchmark
suite on real embeddings and FAISS.

## Run

```bash
bun bench/run.ts --shape quick          # ~20k x 768, 4-bit
bun bench/run.ts --shape quick2         # ~20k x 768, 2-bit
bun bench/run.ts --shape quick-random   # uniform-vector pessimistic floor
bun bench/run.ts --shape full           # 100k x 1536, k=64
bun bench/run.ts --shape all            # all shapes
bun bench/run.ts --shape all --process-repeats 5
```

Requirements:

- Node.js 22.6+ with `--experimental-strip-types` for `bench/node-bench.ts`
- Rust and `cargo`
- A built release binding: `bun run build`

The script builds `examples/native_bench.rs`, generates/caches normalized f32 data under
`bench/.cache/` (gitignored), computes exact ground truth in Rust once, runs Rust and Node
single-threaded/multi-threaded, sweeps Node backpressure, and writes:

- `bench/results/<shape>.json` — raw metrics
- `docs/benchmarks.md` — generated report

## What is measured

- `recall@k` and `recall@1` against exact brute-force dot-product ground truth
- build time, batch search latency, per-query latency, QPS
- RSS after build, RSS after releasing the raw corpus, peak RSS
- serialized index bytes and the binding's conservative index-size estimate
- request p50/p95/p99, QPS, and event-loop delay by concurrency and `UV_THREADPOOL_SIZE`

The normal shapes use 256 clustered centroids (corpus spread 0.35, query spread 0.15).
`quick-random` is the uniform-vector pessimistic floor. Both use normalized synthetic vectors.

## Constraints

- Synthetic recall is a regression signal, not a production recall guarantee.
- Node RSS includes the runtime; compare index payloads and deltas, not only absolute RSS.
- Peak RSS includes the raw corpus plus the native copy during `add`.
- Quick-shape high-concurrency runs can finish inside one event-loop-delay sample; a zero in
  that column is not a claim of zero delay.
- Only Linux x64 results are checked in. Re-run on macOS arm64 and Windows x64 before making
  platform-specific performance claims.
