# Contributing

## Requirements

- Rust 1.89+
- Network access for the crates.io `turbovec = "1.1.2"` dependency

## Checks

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo doc --no-deps
```

## Scope

This crate is a library. Do not add a network listener, daemon, IPC server, auth layer, or global
queue. Consumers own transports and admission control. Keep the service API independent of any
specific server.

## Windows from WSL2

See [`docs/windows-testing.md`](docs/windows-testing.md) for running the native Windows test
suite through WSL interop.

## Tests

- New behavior needs a test that fails without the change.
- Cover both `IndexKind` variants when a change affects shared code.
- Test malformed lengths, closed services, persistence failures, and concurrency where relevant.
- Do not claim platform support from compilation alone; run the integration tests on the target.

## Changes

Keep changes focused. Add user-visible changes to `CHANGELOG.md` and update the API stability
notes. Do not publish to crates.io without explicit maintainer approval.
