# Benchmarks

Generated 2026-10-31 on `linux/x64, Intel(R) Core(TM) i7-9800X CPU @ 3.80GHz, 16 logical CPUs, 31.0 GiB RAM`.

This is a binding benchmark, not a replacement for the upstream turbovec benchmark suite. It
uses deterministic synthetic unit vectors, exact brute-force ground truth, and the same raw
input files for Rust and Node. Normal shapes use 256 clustered centroids with a 0.35 corpus
spread and 0.15 query spread; `quick-random` is the uniform-vector pessimistic floor. It
measures the JS/native boundary and concurrency behavior; it does not measure FAISS, real
embeddings, or recall under every dataset distribution.

## quick shape

`n=20000, dim=768, nq=100, k=10, bits=4, search repeats=5, process repeats=3`

| implementation | threads | build ms | batch search ms | per-query ms |      QPS | recall@k | recall@1 | RSS build MB | RSS release MB | peak MB | serialized MB | estimated MB |
| -------------- | ------: | -------: | --------------: | -----------: | -------: | -------: | -------: | -----------: | -------------: | ------: | ------------: | -----------: |
| rust           |       1 |   456.48 |           24.13 |        0.241 |  4144.20 |   81.00% |   74.00% |        87.81 |          29.28 |  128.18 |          8.21 |         7.41 |
| rust           |      16 |   343.86 |            8.42 |        0.084 | 11882.70 |   81.00% |   74.00% |        89.16 |          30.63 |  127.93 |          8.21 |         7.41 |
| node           |       1 |   498.81 |           24.96 |        0.250 |  4006.92 |   81.00% |   74.00% |       161.09 |         102.61 |  257.12 |          8.21 |         7.41 |
| node           |      16 |   385.49 |            9.04 |        0.090 | 11058.63 |   81.00% |   74.00% |       162.64 |         104.09 |  257.00 |          8.21 |         7.41 |

- Multi-thread Node/Rust batch-search ratio: 1.07x; QPS ratio: 0.93x.
- recall@k difference: 0.00 percentage points.
- RSS after releasing raw vectors: Rust 30.63 MB, Node 104.09 MB (delta 73.46 MB, includes the Node runtime).
- Peak RSS includes the raw corpus and the native copy: Rust 127.93 MB, Node 257.00 MB.
- Index payload: serialized 8.21 MB; conservative estimate 7.41 MB.
- Node ArrayBuffers after release: 0.42 MB; heap used: 8.42 MB.
- Backpressure (UV pool 4): concurrency 1 → 64: QPS 938.38 → 9064.65, p99 1.290 ms → 6.934 ms.

### Backpressure

| UV pool | concurrency | wall ms |     QPS | p50 ms | p95 ms | p99 ms | max ms | event-loop p99 ms |
| ------: | ----------: | ------: | ------: | -----: | -----: | -----: | -----: | ----------------: |
|       4 |           1 |   68.20 |  938.38 |  1.050 |  1.184 |  1.290 |  1.290 |            10.633 |
|       4 |           2 |   35.28 | 1813.93 |  1.082 |  1.201 |  1.350 |  1.350 |            10.019 |
|       4 |           4 |   18.60 | 3441.67 |  1.102 |  1.419 |  1.697 |  1.697 |             0.001 |
|       4 |           8 |   11.72 | 5460.06 |  1.359 |  1.862 |  2.153 |  2.153 |             0.001 |
|       4 |          16 |   10.27 | 6234.28 |  2.210 |  4.301 |  4.316 |  4.316 |             0.001 |
|       4 |          32 |   10.59 | 6045.55 |  3.372 |  8.490 |  9.659 |  9.659 |             0.001 |
|       4 |          64 |    7.06 | 9064.65 |  4.399 |  6.812 |  6.934 |  6.934 |             0.001 |
|      16 |           1 |   74.25 |  862.01 |  1.140 |  1.225 |  1.505 |  1.505 |            10.674 |
|      16 |           2 |   37.46 | 1708.30 |  1.149 |  1.374 |  1.531 |  1.531 |            10.346 |
|      16 |           4 |   19.07 | 3356.71 |  1.128 |  1.543 |  1.731 |  1.731 |             0.001 |
|      16 |           8 |   12.51 | 5116.47 |  1.457 |  2.061 |  2.360 |  2.360 |             0.001 |
|      16 |          16 |   10.39 | 6159.39 |  1.922 |  4.015 |  4.330 |  4.330 |             0.001 |
|      16 |          32 |   10.41 | 6146.24 |  3.985 |  6.956 |  8.041 |  8.041 |             0.001 |
|      16 |          64 |    9.28 | 6896.37 |  4.748 |  7.931 |  9.023 |  9.023 |             0.001 |

## quick2 shape

`n=20000, dim=768, nq=100, k=10, bits=2, search repeats=5, process repeats=3`

| implementation | threads | build ms | batch search ms | per-query ms |      QPS | recall@k | recall@1 | RSS build MB | RSS release MB | peak MB | serialized MB | estimated MB |
| -------------- | ------: | -------: | --------------: | -----------: | -------: | -------: | -------: | -----------: | -------------: | ------: | ------------: | -----------: |
| rust           |       1 |   297.37 |           12.30 |        0.123 |  8128.91 |   52.20% |   41.00% |        76.91 |          18.34 |  124.56 |          4.16 |         3.75 |
| rust           |      16 |   225.74 |            6.47 |        0.065 | 15448.19 |   52.20% |   41.00% |        78.17 |          19.61 |  124.19 |          4.16 |         3.75 |
| node           |       1 |   335.45 |           12.71 |        0.127 |  7870.75 |   52.20% |   41.00% |       151.40 |          92.83 |  253.26 |          4.16 |         3.75 |
| node           |      16 |   262.50 |            6.69 |        0.067 | 14951.70 |   52.20% |   41.00% |       153.09 |          94.50 |  253.47 |          4.16 |         3.75 |

- Multi-thread Node/Rust batch-search ratio: 1.03x; QPS ratio: 0.97x.
- recall@k difference: 0.00 percentage points.
- RSS after releasing raw vectors: Rust 19.61 MB, Node 94.50 MB (delta 74.89 MB, includes the Node runtime).
- Peak RSS includes the raw corpus and the native copy: Rust 124.19 MB, Node 253.47 MB.
- Index payload: serialized 4.16 MB; conservative estimate 3.75 MB.
- Node ArrayBuffers after release: 0.42 MB; heap used: 8.42 MB.
- Backpressure (UV pool 4): concurrency 1 → 64: QPS 1489.66 → 16114.68, p99 0.775 ms → 3.847 ms.

### Backpressure

| UV pool | concurrency | wall ms |      QPS | p50 ms | p95 ms | p99 ms | max ms | event-loop p99 ms |
| ------: | ----------: | ------: | -------: | -----: | -----: | -----: | -----: | ----------------: |
|       4 |           1 |   42.96 |  1489.66 |  0.669 |  0.712 |  0.775 |  0.775 |            10.478 |
|       4 |           2 |   22.10 |  2895.63 |  0.678 |  0.741 |  0.877 |  0.877 |            10.142 |
|       4 |           4 |   12.16 |  5262.86 |  0.734 |  0.937 |  1.002 |  1.002 |             0.001 |
|       4 |           8 |    7.48 |  8551.66 |  0.795 |  1.385 |  1.790 |  1.790 |             0.001 |
|       4 |          16 |    6.73 |  9513.88 |  1.217 |  3.480 |  5.084 |  5.084 |             0.001 |
|       4 |          32 |    8.93 |  7169.48 |  2.808 |  6.628 |  6.968 |  6.968 |             0.001 |
|       4 |          64 |    3.97 | 16114.68 |  2.685 |  3.546 |  3.847 |  3.847 |             0.001 |
|      16 |           1 |   46.57 |  1374.25 |  0.700 |  0.835 |  1.040 |  1.040 |            10.142 |
|      16 |           2 |   22.88 |  2797.30 |  0.699 |  0.825 |  0.870 |  0.870 |             9.839 |
|      16 |           4 |   12.45 |  5140.35 |  0.728 |  1.026 |  1.228 |  1.228 |             0.001 |
|      16 |           8 |    8.34 |  7672.39 |  0.916 |  1.282 |  1.682 |  1.682 |             0.001 |
|      16 |          16 |    6.65 |  9623.04 |  1.212 |  2.877 |  4.057 |  4.057 |             0.001 |
|      16 |          32 |    6.27 | 10201.30 |  1.672 |  4.784 |  6.151 |  6.151 |             0.001 |
|      16 |          64 |    7.22 |  8867.06 |  4.600 |  6.436 |  7.071 |  7.071 |             0.001 |

## quick-random shape

`n=20000, dim=768, nq=100, k=10, bits=4, search repeats=5, process repeats=3`

| implementation | threads | build ms | batch search ms | per-query ms |      QPS | recall@k | recall@1 | RSS build MB | RSS release MB | peak MB | serialized MB | estimated MB |
| -------------- | ------: | -------: | --------------: | -----------: | -------: | -------: | -------: | -----------: | -------------: | ------: | ------------: | -----------: |
| rust           |       1 |   462.59 |           26.63 |        0.266 |  3755.87 |   80.60% |   74.00% |        87.81 |          29.28 |  128.18 |          8.21 |         7.41 |
| rust           |      16 |   345.16 |            8.79 |        0.088 | 11381.71 |   80.60% |   74.00% |        88.93 |          30.41 |  127.81 |          8.21 |         7.41 |
| node           |       1 |   503.29 |           26.01 |        0.260 |  3845.12 |   80.60% |   74.00% |       161.07 |         102.55 |  256.87 |          8.21 |         7.41 |
| node           |      16 |   396.80 |           10.25 |        0.103 |  9754.22 |   80.60% |   74.00% |       162.62 |         104.07 |  256.88 |          8.21 |         7.41 |

- Multi-thread Node/Rust batch-search ratio: 1.17x; QPS ratio: 0.86x.
- recall@k difference: 0.00 percentage points.
- RSS after releasing raw vectors: Rust 30.41 MB, Node 104.07 MB (delta 73.67 MB, includes the Node runtime).
- Peak RSS includes the raw corpus and the native copy: Rust 127.81 MB, Node 256.88 MB.
- Index payload: serialized 8.21 MB; conservative estimate 7.41 MB.
- Node ArrayBuffers after release: 0.42 MB; heap used: 8.42 MB.
- Backpressure (UV pool 4): concurrency 1 → 64: QPS 915.05 → 7562.76, p99 1.334 ms → 8.284 ms.

### Backpressure

| UV pool | concurrency | wall ms |     QPS | p50 ms | p95 ms | p99 ms | max ms | event-loop p99 ms |
| ------: | ----------: | ------: | ------: | -----: | -----: | -----: | -----: | ----------------: |
|       4 |           1 |   69.94 |  915.05 |  1.071 |  1.232 |  1.334 |  1.334 |            10.789 |
|       4 |           2 |   38.35 | 1668.71 |  1.165 |  1.358 |  1.704 |  1.704 |            10.658 |
|       4 |           4 |   19.04 | 3360.69 |  1.107 |  1.554 |  1.735 |  1.735 |             0.001 |
|       4 |           8 |   13.03 | 4912.47 |  1.452 |  2.024 |  2.389 |  2.389 |             0.001 |
|       4 |          16 |    9.21 | 6948.99 |  1.906 |  3.163 |  5.272 |  5.272 |             0.001 |
|       4 |          32 |    9.76 | 6556.61 |  3.009 |  8.260 |  9.612 |  9.612 |             0.001 |
|       4 |          64 |    8.46 | 7562.76 |  5.589 |  7.871 |  8.284 |  8.284 |             0.001 |
|      16 |           1 |   76.31 |  838.72 |  1.162 |  1.429 |  1.583 |  1.583 |            10.838 |
|      16 |           2 |   40.76 | 1570.02 |  1.203 |  1.531 |  1.848 |  1.848 |             9.773 |
|      16 |           4 |   21.06 | 3039.12 |  1.259 |  1.629 |  1.967 |  1.967 |             9.626 |
|      16 |           8 |   12.47 | 5133.92 |  1.437 |  1.863 |  2.381 |  2.381 |             0.001 |
|      16 |          16 |    9.20 | 6953.89 |  1.871 |  3.457 |  3.970 |  3.970 |             0.001 |
|      16 |          32 |   12.40 | 5159.65 |  4.443 |  9.830 | 11.702 | 11.702 |             0.001 |
|      16 |          64 |    7.37 | 8681.23 |  5.323 |  6.643 |  7.086 |  7.086 |             0.001 |

## full shape

`n=100000, dim=1536, nq=100, k=64, bits=4, search repeats=3, process repeats=3`

| implementation | threads | build ms | batch search ms | per-query ms |     QPS | recall@k | recall@1 | RSS build MB | RSS release MB | peak MB | serialized MB | estimated MB |
| -------------- | ------: | -------: | --------------: | -----------: | ------: | -------: | -------: | -----------: | -------------: | ------: | ------------: | -----------: |
| rust           |       1 |  3468.85 |          270.22 |        2.702 |  370.07 |   81.73% |   69.00% |       746.95 |         161.07 | 1249.81 |         75.21 |        73.64 |
| rust           |      16 |  1991.12 |           46.96 |        0.470 | 2129.55 |   81.73% |   69.00% |       748.20 |         162.32 | 1249.44 |         75.21 |        73.64 |
| node           |       1 |  4711.54 |          276.18 |        2.762 |  362.09 |   81.73% |   69.00% |       817.31 |         231.45 | 1906.00 |         75.21 |        73.64 |
| node           |      16 |  2945.83 |           64.02 |        0.640 | 1562.08 |   81.73% |   69.00% |       819.02 |         233.08 | 1906.11 |         75.21 |        73.64 |

- Multi-thread Node/Rust batch-search ratio: 1.36x; QPS ratio: 0.73x.
- recall@k difference: 0.00 percentage points.
- RSS after releasing raw vectors: Rust 162.32 MB, Node 233.08 MB (delta 70.76 MB, includes the Node runtime).
- Peak RSS includes the raw corpus and the native copy: Rust 1249.44 MB, Node 1906.11 MB.
- Index payload: serialized 75.21 MB; conservative estimate 73.64 MB.
- Node ArrayBuffers after release: 0.72 MB; heap used: 8.42 MB.
- Backpressure (UV pool 4): concurrency 1 → 64: QPS 183.35 → 211.21, p99 6.901 ms → 302.649 ms.

### Backpressure

| UV pool | concurrency | wall ms |    QPS |  p50 ms |  p95 ms |  p99 ms |  max ms | event-loop p99 ms |
| ------: | ----------: | ------: | -----: | ------: | ------: | ------: | ------: | ----------------: |
|       4 |           1 |  349.05 | 183.35 |   5.394 |   5.998 |   6.901 |   6.901 |            12.624 |
|       4 |           2 |  322.95 | 198.17 |  10.082 |  11.233 |  12.084 |  12.084 |            14.885 |
|       4 |           4 |  287.02 | 222.98 |  17.133 |  23.089 |  34.499 |  34.499 |            18.924 |
|       4 |           8 |  290.98 | 219.94 |  35.786 |  47.743 |  61.110 |  61.110 |            21.135 |
|       4 |          16 |  294.78 | 217.11 |  68.458 |  93.555 |  95.891 |  95.891 |            20.578 |
|       4 |          32 |  296.75 | 215.67 | 131.563 | 248.953 | 249.623 | 249.623 |            42.303 |
|       4 |          64 |  303.02 | 211.21 | 171.802 | 300.201 | 302.649 | 302.649 |            17.400 |
|      16 |           1 |  388.69 | 164.65 |   5.832 |   7.423 |  11.244 |  11.244 |            14.139 |
|      16 |           2 |  344.36 | 185.85 |  10.361 |  12.716 |  17.619 |  17.619 |            14.770 |
|      16 |           4 |  305.97 | 209.17 |  18.934 |  25.100 |  32.629 |  32.629 |            17.924 |
|      16 |           8 |  288.14 | 222.11 |  33.805 |  51.653 |  64.433 |  64.433 |            25.625 |
|      16 |          16 |  302.53 | 211.55 |  73.362 | 108.947 | 110.276 | 110.276 |            21.692 |
|      16 |          32 |  302.15 | 211.81 | 139.813 | 162.020 | 188.256 | 188.256 |            23.429 |
|      16 |          64 |  301.05 | 212.59 | 182.660 | 295.383 | 298.018 | 298.018 |            26.165 |

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
- Pin `RAYON_NUM_THREADS=1` and the host's logical CPU count to expose the single-thread and
  multi-thread paths.
- Sweep Node request concurrency and `UV_THREADPOOL_SIZE`; record p50/p95/p99 request latency
  and event-loop delay. The default libuv pool is four threads, and increasing it without a
  matching CPU budget can cause oversubscription.
- Raw results: `bench/results/*.json`. Harness: `bench/run.ts`, `bench/node-bench.ts`,
  `examples/native_bench.rs`.

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
- Ground truth is computed once and cached under `bench/.cache/`.
- Full shape is heavier; use `bun bench/run.ts --shape quick` for the fast loop.
- Only Linux x64 was run here. macOS arm64 and Windows x64 need the same harness on their
  hardware before platform claims are made.
