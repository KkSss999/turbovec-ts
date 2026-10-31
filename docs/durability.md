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
- Windows: the core's rename path is used; no directory fsync equivalent exists. Verify on the
  target.
- macOS: compile-checked; run the integration tests and a packaged consumer on arm64 before
  claiming support.
- Linux arm64, Windows arm64, macOS x64: compile-checked only until the target tests are run.

The service library does not add its own durability warning channel. File and format behavior is
owned by the upstream core.
