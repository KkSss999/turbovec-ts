# Consumer examples

These crates are not part of `turbovec-service`. They show where the consumer-owned boundary
belongs:

- `cli/` — a small CLI around the Rust API
- `http-server/` — an Axum HTTP adapter; add auth, limits, and binary payloads for production
- `ipc/` — a Unix-socket, newline-JSON example; Windows consumers should use their own transport

Run them with their own manifests:

```bash
cargo run --manifest-path consumers/cli/Cargo.toml
cargo run --manifest-path consumers/ipc/Cargo.toml -- /tmp/turbovec-demo.sock
cargo run --manifest-path consumers/http-server/Cargo.toml
```

The HTTP and IPC examples use demo vectors and are intentionally minimal. They do not add
backpressure, authentication, tenancy, request size limits, or a stable wire protocol. Those are
consumer responsibilities. A production gRPC adapter should follow the same pattern with tonic
and a protobuf schema; it is not shipped here.
