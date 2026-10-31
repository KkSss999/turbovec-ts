# Service benchmark

Generated 2026-10-31 on `linux/x64, Intel(R) Core(TM) i7-9800X CPU @ 3.80GHz, 16 logical CPUs`.

This measures the in-process `Service` wrapper against a direct `TurboQuantIndex` search. It is
not a server, IPC, or network benchmark.

## Method

- Deterministic normalized synthetic vectors, generated independently for the corpus and queries.
- Build the index before timing; warm both search paths; report the median of 5-7 in-process
  repeats.
- Run `--impl core` and `--impl service` in separate processes for the published single-thread and
  multi-thread numbers.
- Pin `RAYON_NUM_THREADS=1` for the single-thread path and use the host's logical CPU count for
  the multi-thread path.
- The `Service` wrapper adds validation, a read lock, an enum result, and stats access. It does
  not add IPC or a queue.

```bash
RAYON_NUM_THREADS=1 cargo run --release --example service_bench -- --impl core --dim 1536 --n 100000 --nq 100 --k 64 --repeats 7
RAYON_NUM_THREADS=1 cargo run --release --example service_bench -- --impl service --dim 1536 --n 100000 --nq 100 --k 64 --repeats 7
RAYON_NUM_THREADS=16 cargo run --release --example service_bench -- --impl service --dim 768 --n 20000 --nq 100 --k 10 --repeats 7
```

## 100K x 1536, 4-bit, k=64, single thread

| implementation | search ms | QPS |
|---|---:|---:|
| direct core | 251.9-258.6 | ~387-397 |
| service | 248.1-252.1 | ~397-403 |

The wrapper is below the measurement noise on this path. The direct core and service produce the
same result kind and recall because both call the same core.

## 20K x 768, 4-bit, k=10, 16 threads

| implementation | search ms | QPS |
|---|---:|---:|
| direct core | 7.44-8.60 | ~11.6-13.4K |
| service | 7.29-8.91 | ~11.2-13.7K |

Service overhead across three separate runs: **-3.4% to +4.0%, median +3.5%**. Treat that as
noise-level wrapper overhead, not a performance claim.

## 100K x 1536, 4-bit, k=64, 16 threads

Observed ranges:

| implementation | search ms |
|---|---:|
| direct core | 35.9-79.3 |
| service | 37.3-59.2 |

The shared host showed large run-to-run and thermal variance at this size. The wrapper's lock and
result-enum cost is not separable from that variance here. Re-run on the target machine before
using a multi-thread number in a capacity plan. The single-thread result above is the stable
wrapper-overhead measurement.

## Index size

At 100K x 1536, 4-bit:

```text
serialized bytes: 78,849,636  (~75.2 MiB)
estimated bytes:  77,216,384  (~73.6 MiB)
```

`Stats::serialized_bytes` is exact. For an id-map index it currently materializes the image
because the core does not expose a length-only method; do not call it on every request.

## Caveats

- Synthetic vectors are a regression signal, not a production recall claim. Use real embeddings
  for recall decisions.
- Build time is not compared: the first parallel build in a process includes rayon pool
  initialization.
- Multi-thread numbers on this shared host are noisy; single-thread and the 20K shape are stable.
- Only Linux x64 was run. Re-run on macOS arm64 and Windows x64 before making platform claims.
- No server, HTTP, gRPC, or IPC overhead is included. Those are consumer-owned layers.
