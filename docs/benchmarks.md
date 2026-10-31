# B1 benchmark

Generated 2026-10-31 on Linux x64 and Windows x64.

B1 is the packaged JS client + Rust sidecar. Direct core is the in-process Rust baseline on the same raw data. These numbers measure the package boundary, not recall or a server.

## Linux x64

### quick (20000 x 768, k=10)

| metric | B1 sidecar | direct core |
|---|---:|---:|
| cold start (median) | 132.1 ms | n/a |
| add | 163.5 ms | 175.7 ms |
| single query p50 | 1.015 ms | 0.781 ms |
| single query p99 | 1.300 ms | 0.881 ms |
| single query QPS | 986 | 1281 |
| 100-query batch p50 | 8.01 ms | 7.26 ms |
| 100-query batch QPS | 12480 | 13778 |
| RSS after add: Node / sidecar | 115.9 / 64.6 MB | 69.3 MB |
| RSS after search: Node / sidecar | 116.7 / 67.1 MB | n/a |

sidecar stats: `{"kind":"dense","dim":768,"bits":4,"len":20000,"serialized_bytes":8599396,"estimated_bytes":7770240}`

### full (100000 x 1536, k=64)

| metric | B1 sidecar | direct core |
|---|---:|---:|
| cold start (median) | 143.7 ms | n/a |
| add | 1200.5 ms | 659.6 ms |
| single query p50 | 5.258 ms | 5.154 ms |
| single query p99 | 6.028 ms | 6.488 ms |
| single query QPS | 190 | 194 |
| 100-query batch p50 | 40.24 ms | 40.98 ms |
| 100-query batch QPS | 2485 | 2440 |
| RSS after add: Node / sidecar | 704.3 / 138.6 MB | 663.6 MB |
| RSS after search: Node / sidecar | 705.4 / 143.6 MB | n/a |

sidecar stats: `{"kind":"dense","dim":1536,"bits":4,"len":100000,"serialized_bytes":78849636,"estimated_bytes":77216384}`

## Windows x64

### quick (20000 x 768, k=10)

| metric | B1 sidecar | direct core |
|---|---:|---:|
| cold start (median) | 145.1 ms | n/a |
| add | 125.2 ms | 160.0 ms |
| single query p50 | 0.865 ms | 0.706 ms |
| single query p99 | 4.808 ms | 1.006 ms |
| single query QPS | 1156 | 1416 |
| 100-query batch p50 | 5.49 ms | 4.09 ms |
| 100-query batch QPS | 18214 | 24427 |
| RSS after add: Node / sidecar | 103.3 / 29.2 MB | n/a |
| RSS after search: Node / sidecar | 104.0 / 31.2 MB | n/a |

sidecar stats: `{"kind":"dense","dim":768,"bits":4,"len":20000,"serialized_bytes":8599396,"estimated_bytes":7770240}`

### full (100000 x 1536, k=64)

| metric | B1 sidecar | direct core |
|---|---:|---:|
| cold start (median) | 152.4 ms | n/a |
| add | 1402.2 ms | 554.2 ms |
| single query p50 | 4.814 ms | 4.758 ms |
| single query p99 | 6.831 ms | 6.134 ms |
| single query QPS | 208 | 210 |
| 100-query batch p50 | 34.54 ms | 30.42 ms |
| 100-query batch QPS | 2895 | 3288 |
| RSS after add: Node / sidecar | 690.7 / 96.2 MB | n/a |
| RSS after search: Node / sidecar | 693.0 / 96.6 MB | n/a |

sidecar stats: `{"kind":"dense","dim":1536,"bits":4,"len":100000,"serialized_bytes":78849636,"estimated_bytes":77216384}`

## Findings

- Cold start is about 130–152 ms on both hosts.
- Single-query B1 latency is above direct core on the quick shape; the full shape is dominated by search work and is close to noise.
- Full-shape `add` is 1.8× (Linux) to 2.5× (Windows) direct core because the corpus is copied through the sidecar. Chunking lowers peak memory but cannot remove the copy.
- Node RSS after add includes the raw corpus in the benchmark process; sidecar RSS is the resident index. On the full shape the sidecar is much smaller than the direct-core process, which still holds the raw corpus.
- Batch numbers are sensitive to host warmth/scheduling. Do not use the full-shape batch delta as a sidecar speed claim without a target-machine rerun.
- Windows core RSS is `n/a` because the baseline does not expose a portable Windows RSS probe in this harness.
## Caveats

- The sidecar uses the package-owned framed stdio transport.
- The direct core baseline has no IPC, process startup, or Node runtime.
- Single-query sidecar numbers include process round-trips; batch numbers include one round-trip per batch.
- Synthetic normalized vectors are a regression signal, not a production recall claim.
- No server, HTTP, gRPC, or IPC server is benchmarked. Those are consumer-owned layers.
