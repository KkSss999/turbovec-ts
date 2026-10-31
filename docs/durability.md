# Durability

## Modes

`write` and `checkpoint` default to the caller's choice of `Durability`:

- `Durable`: fsync the file, rename, then fsync the parent directory on Unix
- `Fast`: temp file + rename, skipping fsync

`Fast` is only process-crash safe. After a power loss the new file may be missing or truncated,
and the previous file may also be lost. Use it only for disposable or regenerable data.
`Durable` is the safe choice for a primary copy.

## Single writer

`sync` incrementally writes to one path and must have a single writer. Do not call `sync` on the
same path from multiple processes. `write`/`checkpoint` are full snapshots and can replace a
destination atomically, but concurrent writers still need an application-level rule.

## Platform notes

- Linux x64: integration tests cover local persistence.
- Windows x64: native `cargo test` and the CLI example pass from the Windows toolchain
  (run through WSL2 interop). The core's rename path is used; there is no directory fsync
  equivalent.
- macOS arm64: pending target runtime tests.
- Linux arm64 and Windows arm64: explicitly unsupported; do not adapt or redistribute.
- macOS x64 and Linux musl: out of scope.

The service library does not add its own durability warning channel. File and format behavior is
owned by the upstream core.
