# turbovec-service

Rust service-layer API for [turbovec](https://github.com/RyanCodrai/turbovec), a vector index with
2-4 bit quantization and SIMD search.

## Status

**0.2.0, pre-release.** The public API is not frozen. This is a direction change from the
archived 0.1.1 N-API package:

- the runtime and public API are Rust
- the package is a library, not a daemon
- no server, HTTP, gRPC, IPC, auth, tenancy, or global request queue is included
- consumers own transport, admission control, deployment, and client SDKs

The previous N-API implementation is preserved at the git tag `archive/napi-0.1.1`.

Platform scope:

- **Tested:** Linux x64, Windows x64
- **Pending:** macOS arm64
- **Explicitly unsupported:** Linux arm64, Windows arm64, macOS x64, Linux musl

Linux arm64 and Windows arm64 are not adaptation targets. Compilation on another target is not a
support claim.

## Scope

```text
domain   upstream turbovec core        quantization, SIMD kernels, format, search
service  this crate                   index lifecycle, validation, persistence, stats
api      this crate's public Rust API
server   consumer                     HTTP / gRPC / CLI / IPC / auth / queues
```

This is not a service process. `Service` owns one index and is intended to be embedded in a
consumer's process or wrapped by a consumer's server.

## Install

The crate is not published yet; use a path or a pinned git revision. It depends on the
crates.io `turbovec = "1.1.2"` core:

```toml
[dependencies]
turbovec-service = { path = "../turbovec-node" }
```

## Example

```rust
use turbovec_service::{
    Config, Durability, IndexKind, SearchResult, Service,
};

let service = Service::new(Config::new(768, 4, IndexKind::Dense))?;
service.add(&vectors)?;

let SearchResult::Dense(result) = service.search(&queries, 10)? else {
    unreachable!("dense service returns dense results");
};

service.checkpoint("index.tv", Durability::Durable)?;
let loaded = Service::load(IndexKind::Dense, "index.tv")?;

# Ok::<(), turbovec_service::ServiceError>(())
```

For external ids use `IndexKind::IdMap`, `add_with_ids`, `remove`, `contains`, `iter_ids`, and
`search_with_allowlist`.

## API overview

| Type | Purpose |
|---|---|
| `Service` | One owned index plus lifecycle and locking |
| `Config` | `dim`, `bit_width`, `IndexKind` |
| `IndexKind` | `Dense` or `IdMap` |
| `SearchResult` | `Dense(SearchResults)` or `IdMap(IdSearchResults)` |
| `Stats` | kind, dim, bits, length, serialized and estimated bytes |
| `ServiceError` / `ErrorCode` | stable error categories |
| `Durability` | `Durable` or `Fast` snapshot mode |

`Service` is `Send + Sync`. Searches take a read lock and can overlap; mutations and `sync` take
the write lock. There is no internal queue: callers decide how many operations to admit.

## Build and test

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo doc --no-deps
```

There is no Node, npm, Bun, or Python runtime dependency. The optional upstream Python package is
unrelated to this crate.

## Benchmark

```bash
RAYON_NUM_THREADS=1 cargo run --release --example service_bench -- --impl core --dim 1536 --n 100000 --nq 100 --k 64 --repeats 7
RAYON_NUM_THREADS=1 cargo run --release --example service_bench -- --impl service --dim 1536 --n 100000 --nq 100 --k 64 --repeats 7
```

See [`docs/benchmarks.md`](docs/benchmarks.md).

## Consumer examples

[`consumers/`](consumers/README.md) contains separate CLI, HTTP, IPC, and pmem-sidecar examples.
They are not part of this library and are not published. See
[`docs/pmem-integration.md`](docs/pmem-integration.md) for the pmem adapter pattern.

## Documentation

- Architecture: [`docs/architecture.md`](docs/architecture.md)
- API stability: [`docs/api-stability.md`](docs/api-stability.md)
- Durability: [`docs/durability.md`](docs/durability.md)
- Benchmark: [`docs/benchmarks.md`](docs/benchmarks.md)
- Windows testing from WSL2: [`docs/windows-testing.md`](docs/windows-testing.md)
- Release process: [`docs/release.md`](docs/release.md)

## License

MIT. The crate links the turbovec core, also MIT; see [`LICENSE`](LICENSE) and
[`LICENSE-TURBOVEC`](LICENSE-TURBOVEC).
