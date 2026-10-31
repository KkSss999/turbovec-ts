# Durability

## Modes

`checkpoint`/`write` accept `durable` (default `true`):

- `true`: the Rust core fsyncs the file, renames it, and fsyncs the parent directory on Unix
- `false`: temp file + rename without fsync

`false` is only process-crash safe. A power loss may lose the new file and possibly the previous
file. Use it only for disposable/regenerable data.

## Sidecar ownership

The package starts one sidecar per index instance. `checkpoint` is sent to the Rust process; the
JS process never holds the index buffer. `sync` is single-writer per path.

## Platform notes

- Linux x64: integration tests and packaged-client tests pass.
- Windows x64: native sidecar tests and packaged-client tests pass.
- macOS arm64: native tests and the packaged client smoke pass.
- Linux arm64, Windows arm64, macOS x64, Linux musl: unsupported.

On Windows the core uses its normal rename path; there is no directory-fsync equivalent. The
package does not add a separate durability warning channel.
