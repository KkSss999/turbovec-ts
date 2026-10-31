# B1 benchmark

Generated 2026-10-31 on `linux/x64`.

B1 is the packaged JS client + Rust sidecar. Direct core is the in-process Rust baseline on the same raw data. This measures the package boundary, not recall or a server.

## quick (20000 x 768, k=10)

| metric | B1 sidecar | direct core |
|---|---:|---:|
| cold start (median) | 124.1 ms | n/a |
| add | 183.6 ms | 178.2 ms |
| single query p50 | 0.973 ms | 0.795 ms |
| single query p99 | 1.550 ms | 0.920 ms |
| single query QPS | 1028 | 1257 |
| 100-query batch p50 | 7.34 ms | 7.41 ms |
| 100-query batch QPS | 13629 | 13504 |

sidecar stats: {"kind":"dense","dim":768,"bits":4,"len":20000,"serialized_bytes":8599396,"estimated_bytes":7770240}

## full (100000 x 1536, k=64)

| metric | B1 sidecar | direct core |
|---|---:|---:|
| cold start (median) | 138.7 ms | n/a |
| add | 2072.0 ms | 714.2 ms |
| single query p50 | 5.316 ms | 5.545 ms |
| single query p99 | 6.636 ms | 7.093 ms |
| single query QPS | 188 | 180 |
| 100-query batch p50 | 39.54 ms | 90.50 ms |
| 100-query batch QPS | 2529 | 1105 |

sidecar stats: {"kind":"dense","dim":1536,"bits":4,"len":100000,"serialized_bytes":78849636,"estimated_bytes":77216384}

## Caveats

- The sidecar uses the package-owned framed stdio transport.
- The direct core baseline has no IPC, process startup, or Node runtime.
- Single-query sidecar numbers include process round-trips; batch numbers include one round-trip per batch.
- Only Linux x64 is collected by this script. Windows x64 must be run separately.
- Synthetic normalized vectors are a regression signal, not a production recall claim.
## Interpretation

- Cold start is roughly 120–140 ms on this Linux x64 host; this is the cost of starting a Rust process, not a query cost.
- Single-query B1 latency is higher than direct core because every query crosses the stdio boundary. The quick shape shows the clearest cost; the full shape is dominated by search work and is close to noise.
- Full-shape `add` is about 2.9× the direct core because the whole 614 MB corpus is copied through the sidecar. Large bulk loads should be considered an IPC cost.
- Batch QPS is sensitive to host warmth and scheduling. Do not use the full-shape batch delta as a sidecar speed claim without a target-machine rerun.
- The sidecar can keep the index out of the Node heap and apply its own lifecycle/backpressure policy; those benefits are not measured by these single-process latency numbers.
