# Release process

The crate is not published. `Cargo.toml` keeps `publish = false` until an explicit release
decision.

## Preflight

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo doc --no-deps
```

Update `CHANGELOG.md`, `README.md`, and the version in `Cargo.toml` before tagging.

## Versioning

- `0.2.0` is the first service-layer pre-release.
- The archived N-API implementation is the git tag `archive/napi-0.1.1`; do not reuse its
  version or package name.
- The crate depends on the crates.io `turbovec = "1.1.2"` package, not a sibling path. A future
  crates.io release only requires changing `publish = false` and following the normal publish
  approval; do not publish implicitly.

## Release artifact

A release is currently a git tag plus source. The crate can be consumed as a path or git
dependency. A crates.io package is a separate decision because it changes the core dependency
from a path to a registry version.

## Cutover rule

Do not add a server, daemon, or IPC layer to make a release possible. Consumers own transport.
The service library's release boundary is the Rust API and its tests.
