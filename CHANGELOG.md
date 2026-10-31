# Changelog

All notable changes to `turbovec-service` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - 2026-10-31

Published.

### Changed

- Product shape is now B1: JS/TS package with a bundled Rust sidecar. Consumers install and
  import the package; they do not need Rust or a consumer-written IPC adapter.
- The sidecar transport is package-private and framed over stdio.

### Added

- `turbovecd` sidecar and the `turbovec-ts` JS client.
- Dense and id-map add/search, masks/allowlists, snapshots, sync, calibration, stats, close, and
  load.
- Bundled Linux x64 glibc, Linux x64 musl, Windows x64, and macOS arm64 sidecar binaries.

### Removed

- B2 consumer-side adapter examples and pmem integration instructions.

### API

- `0.3.x` JS API surface is frozen; see `docs/api-stability.md`.

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
- Consumer-owned examples: CLI, Axum HTTP server, cross-platform local-socket IPC, and a
  pmem-style JSON-lines sidecar.
- The core dependency now comes from crates.io (`turbovec = "1.1.2"`), so consumers do not need a
  sibling core checkout.
- `service_bench` example and a service-layer benchmark report.

### Removed

- N-API/Node bindings, JS/TS wrappers, npm packaging, Electron examples, Node benchmarks, and
  Bun-based tooling.
- The previous Node/Python interop test harness.

### Compatibility

- Rust 1.89+.
- Platform scope: Linux x64, Windows x64, and macOS arm64 are tested. Linux arm64, Windows arm64,
  macOS x64, and Linux musl are explicitly unsupported.
- The archived N-API release candidate is available at git tag `archive/napi-0.1.1`.
- The crate is not published to crates.io.
