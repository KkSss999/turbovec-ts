# B1 benchmark

Generated 2026-10-31 on Linux x64, Windows x64, and macOS arm64.

B1 is the packaged JS client + Rust sidecar. Direct core is the in-process Rust baseline on the same raw data. This measures the package boundary, not recall or a server.

## Linux x64

### quick (20000 x 768, k=10)

| metric | B1 sidecar | direct core |
|---|---:|---:|
| cold start (median) | 126.3 ms | n/a |
| add | 174.8 ms | 184.9 ms |
| single query p50 | 1.202 ms | 0.834 ms |
| single query p99 | 2.486 ms | 1.446 ms |
| single query QPS | 832 | 1199 |
| 100-query batch p50 | 9.43 ms | 8.04 ms |
| 100-query batch QPS | 10604 | 12444 |
| RSS after add: Node / sidecar | 117.4 / 64.5 MB | 69.4 MB |
| RSS after search: Node / sidecar | 117.9 / 67.4 MB | n/a |

sidecar stats: {"kind":"dense","dim":768,"bits":4,"len":20000,"serialized_bytes":8599396,"estimated_bytes":7770240}

### full (100000 x 1536, k=64)

| metric | B1 sidecar | direct core |
|---|---:|---:|
| cold start (median) | 143.9 ms | n/a |
| add | 1203.4 ms | 805.4 ms |
| single query p50 | 5.980 ms | 5.787 ms |
| single query p99 | 7.825 ms | 50.204 ms |
| single query QPS | 167 | 173 |
| 100-query batch p50 | 38.95 ms | 91.50 ms |
| 100-query batch QPS | 2567 | 1093 |
| RSS after add: Node / sidecar | 705.4 / 140.8 MB | 663.5 MB |
| RSS after search: Node / sidecar | 705.8 / 145.6 MB | n/a |

sidecar stats: {"kind":"dense","dim":1536,"bits":4,"len":100000,"serialized_bytes":78849636,"estimated_bytes":77216384}

## Windows x64

### quick (20000 x 768, k=10)

| metric | B1 sidecar | direct core |
|---|---:|---:|
| cold start (median) | 148.0 ms | n/a |
| add | 130.8 ms | 159.4 ms |
| single query p50 | 0.871 ms | 0.702 ms |
| single query p99 | 1.253 ms | 0.761 ms |
| single query QPS | 1148 | 1425 |
| 100-query batch p50 | 5.09 ms | 4.14 ms |
| 100-query batch QPS | 19663 | 24163 |
| RSS after add: Node / sidecar | 103.0 / 29.2 MB | 72.3 MB |
| RSS after search: Node / sidecar | 103.4 / 31.5 MB | n/a |

sidecar stats: {"kind":"dense","dim":768,"bits":4,"len":20000,"serialized_bytes":8599396,"estimated_bytes":7770240}

### full (100000 x 1536, k=64)

| metric | B1 sidecar | direct core |
|---|---:|---:|
| cold start (median) | 151.4 ms | n/a |
| add | 1440.1 ms | 570.4 ms |
| single query p50 | 4.413 ms | 4.432 ms |
| single query p99 | 5.021 ms | 5.977 ms |
| single query QPS | 227 | 226 |
| 100-query batch p50 | 37.64 ms | 31.08 ms |
| 100-query batch QPS | 2657 | 3217 |
| RSS after add: Node / sidecar | 690.6 / 95.8 MB | 666.7 MB |
| RSS after search: Node / sidecar | 691.4 / 96.9 MB | n/a |

sidecar stats: {"kind":"dense","dim":1536,"bits":4,"len":100000,"serialized_bytes":78849636,"estimated_bytes":77216384}

## macOS arm64

### quick (20000 x 768, k=10)

| metric | B1 sidecar | direct core |
|---|---:|---:|
| cold start (median) | 47.5 ms | n/a |
| add | 34.2 ms | 66.9 ms |
| single query p50 | 0.285 ms | 0.255 ms |
| single query p99 | 0.311 ms | 0.265 ms |
| single query QPS | 3514 | 3927 |
| 100-query batch p50 | 2.24 ms | 2.12 ms |
| 100-query batch QPS | 44685 | 47272 |
| RSS after add: Node / sidecar | 112.6 / 64.1 MB | 142.9 MB |
| RSS after search: Node / sidecar | 113.5 / 66.8 MB | n/a |

sidecar stats: {"kind":"dense","dim":768,"bits":4,"len":20000,"serialized_bytes":8599396,"estimated_bytes":7770240}

### full (100000 x 1536, k=64)

| metric | B1 sidecar | direct core |
|---|---:|---:|
| cold start (median) | 49.7 ms | n/a |
| add | 291.3 ms | 174.0 ms |
| single query p50 | 0.305 ms | 0.263 ms |
| single query p99 | 2.281 ms | 2.279 ms |
| single query QPS | 3280 | 3807 |
| 100-query batch p50 | 10.31 ms | 10.02 ms |
| 100-query batch QPS | 9699 | 9979 |
| RSS after add: Node / sidecar | 700.7 / 106.7 MB | 1258.6 MB |
| RSS after search: Node / sidecar | 702.0 / 183.3 MB | n/a |

sidecar stats: {"kind":"dense","dim":1536,"bits":4,"len":100000,"serialized_bytes":78849636,"estimated_bytes":77216384}

## Caveats

- The sidecar uses the package-owned framed stdio transport.
- The direct core baseline has no IPC, process startup, or Node runtime.
- Single-query sidecar numbers include process round-trips; batch numbers include one round-trip per batch.
- This script collects one host at a time; run it on each supported platform.
- Synthetic normalized vectors are a regression signal, not a production recall claim.
