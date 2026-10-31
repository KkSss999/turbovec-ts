# Testing

## Fast suite

```bash
cargo test --locked --all-targets
bun test
```

`bun test` sets a 30-second per-test timeout so Windows cold starts do not fail the suite.

Coverage:

- public dense and id-map smoke workflows
- invalid input and disposed-instance error codes
- chunk rollback for dense `add` and id-map `addWithIds`
- concurrent searches, stats, and bulk adds
- repeated search/stat cycles
- sidecar kill during a pending search, followed by checkpoint reload
- CJS and ESM entry points

## Soak

```bash
bun scripts/soak.mjs
TURBOVEC_SOAK_SECONDS=300 TURBOVEC_SOAK_ROWS=4096 bun scripts/soak.mjs
```

The soak runs a timed mix of searches, stats calls, and small adds. It checks every search result
and the final index length, then reports Node RSS, sidecar RSS, operations, and operations/second.
It exits non-zero on drift or an invalid result.

Measured on 2026-10-31:

| host | duration | ops | sidecar RSS |
|---|---:|---:|---:|
| Linux x64 glibc | 60 s | 1,084,576 | 3.2 → 3.5 MB |
| macOS arm64 | 30 s | 1,920,000 | 6.4 → 7.6 MB |
| Windows x64 | 30 s | 680,608 | 5.4 → 6.1 MB |

Node RSS stayed below 60 MB in these runs. These are stability checks, not throughput benchmarks.

## Crash recovery

The crash test kills the sidecar while a large search is pending, asserts that the pending request
rejects with `TurbovecError`, and then loads the last checkpoint into a fresh sidecar. The package
does not restart a killed sidecar automatically; callers reload a checkpoint.

## musl

The package selects `bin/linux-x64-musl/turbovecd` on musl systems. The static binary is tested in
`node:24-alpine`, including the selected path:

```text
/app/node_modules/turbovec-ts/bin/linux-x64-musl/turbovecd
```
