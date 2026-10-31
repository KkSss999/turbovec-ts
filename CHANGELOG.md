# Changelog

All notable changes to `turbovec-ts` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) with the pre-1.0 policy described in
[`docs/api-stability.md`](docs/api-stability.md).

## [Unreleased]

## [0.1.1] - 2026-10-31

Prepared release candidate. Not published.

### Added

- `TurboQuantIndex`: add, swap-remove, exact search, byte masks, persistence, calibration,
  disposal, memory accounting, and snapshot checkpointing.
- `IdMapIndex`: u64 external ids, allowlist search, removal, iteration, persistence, and
  snapshot checkpointing.
- `Float32Array` input, `BigUint64Array` and `bigint` ids, plus explicit CJS and ESM entry
  points.
- Atomic `write`, incremental `sync`, and streaming `checkpoint` with temp-file + rename,
  stale-temp cleanup, and optional `durable` mode.
- `lastWarning` for a committed checkpoint whose parent-directory fsync failed.
- Typed `TurbovecError` codes for disposed, locked, invalid-input, IO, native, unsupported,
  and task failures.
- Packaged Electron utilityProcess example and Linux x64 smoke test.
- Optional Python format-interop tests with a strict version gate.
- Release preflight, API stability policy, durability notes, and versioned-checkpoint recipe.
- Rust-vs-Node benchmark harness for recall, latency, memory, and backpressure, with raw JSON
  results and a generated report.

### Changed

- Clarified the product boundary: the package is an in-process library, not a server. Consumers
  own HTTP/gRPC/CLI/IPC, queues, auth, and tenancy. Service-mode migration is explicitly
  rejected and kept as an ADR. This aligns with the upstream Python SDK's PyO3 model.

- Version moved from `0.0.1` to `0.1.1`.
- Checkpoint serialization streams to a temp file instead of copying the full image in memory.
- Windows checkpoint rename uses `MoveFileExW` with `MOVEFILE_WRITE_THROUGH`.
- The TypeScript/native suite is the default test command; Python interop is a separate strict
  command and remains optional for consumers.

### Fixed

- Constructor failures now map to `TurbovecError` instead of leaking a raw native error.
- Invalid vector lengths and id-batch sizes are rejected before entering the native core,
  avoiding a worker panic.
- Parent-directory fsync failures after a committed checkpoint are reported through
  `lastWarning` instead of being silently ignored.

### Compatibility

- Node.js 20.17+ and Node-API 8.
- Linux x64 is built, tested, and packaged; Linux arm64, Windows x64/arm64, and macOS x64/arm64
  compile but still require runtime smoke before they can be called supported.
- Python is a test peer only and is not an SDK runtime dependency.

### Security

- The turbovec core is MIT-licensed; `LICENSE-TURBOVEC` is included in the package.
- No known security issues are fixed or disclosed in this release.
