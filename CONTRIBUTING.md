# Contributing

## Requirements

- Rust 1.89+
- Bun
- Node.js 20.17+ for the packaged client
- Windows only for Windows-specific sidecar tests

## Checks

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo doc --no-deps
bun test
```

## Architecture boundary

- The package owns the JS client, sidecar lifecycle, and private framed stdio protocol.
- Consumers own HTTP/gRPC/MCP/CLI/server layers and their own wire protocols.
- Do not add a public server or consumer adapter to the package.
- Do not add an install script that compiles Rust on a consumer machine.

## Tests

- New behavior needs a test that fails without the change.
- Cover both dense and id-map clients.
- Test sidecar startup, shutdown, error mapping, and persisted load.
- Platform support requires a real target binary and smoke test; compilation alone is not enough.

## Release

Do not publish until `private: true` and `publish = false` are explicitly changed. See
[`docs/release.md`](docs/release.md).
