# Changelog

All notable changes to `turbovec-service` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-10-31

Pre-release. Not published.

### Changed

- Direction change: the Node/N-API binding is removed from the active product. The runtime and
  public API are now Rust.
- The package is a service-layer library, not a daemon. Server and IPC transports are owned by
  consumers.
- The core runtime remains the upstream `turbovec` crate; this crate adds lifecycle, validation,
  persistence, statistics, and stable errors.

### Added

- `Service` with one owned `TurboQuantIndex` or `IdMapIndex`.
- `Config`, `IndexKind`, `SearchResult`, `Stats`, `ServiceError`, and `ErrorCode`.
- Dense and id-map add, search, masks, allowlists, removal, calibration, preparation, snapshots,
  incremental sync, byte round-trips, and close semantics.
- Read-lock concurrent search and write-lock mutation/sync behavior.
- Rust integration tests covering both index kinds, 2/3/4-bit widths, persistence, malformed
  input, close, and concurrent searches.
- Consumer-owned examples: CLI, Axum HTTP server, and Unix-socket IPC.
- `service_bench` example and a service-layer benchmark report.

### Removed

- N-API/Node bindings, JS/TS wrappers, npm packaging, Electron examples, Node benchmarks, and
  Bun-based tooling.
- The previous Node/Python interop test harness.

### Compatibility

- Rust 1.89+.
- The archived N-API release candidate is available at git tag `archive/napi-0.1.1`.
- The crate is not published to crates.io.
