# Consumer examples

These crates are not part of `turbovec-service`. They show where the consumer-owned boundary
belongs:

- `cli/` — a small CLI around the Rust API
- `http-server/` — an Axum HTTP adapter; add auth, limits, and binary payloads for production
- `ipc/` — a cross-platform local-socket example (Unix domain socket or Windows named pipe)
- `pmem-sidecar/` — a pmem-owned JSON-lines sidecar over stdio

Run them with their own manifests:

```bash
cargo run --manifest-path consumers/cli/Cargo.toml
cargo run --manifest-path consumers/ipc/Cargo.toml -- server
cargo run --manifest-path consumers/ipc/Cargo.toml -- client
cargo run --manifest-path consumers/http-server/Cargo.toml
cargo run --manifest-path consumers/pmem-sidecar/Cargo.toml -- --dim 8 --bits 4
```

The HTTP and IPC examples use demo vectors and are intentionally minimal. The IPC example uses
`interprocess`: Unix domain sockets on Unix and named pipes on Windows. They do not add
backpressure, authentication, tenancy, request size limits, or a stable wire protocol. Those are
consumer responsibilities. A production gRPC adapter should follow the same pattern with tonic
and a protobuf schema; it is not shipped here.
