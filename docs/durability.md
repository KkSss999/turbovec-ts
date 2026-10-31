# Durability and platform status

## Modes

`write(path, durable?)` and `checkpoint(path, durable?)` both default to durable.

| Mode            | File fsync | Parent-dir fsync                     | Process crash            | Power loss                        |
| --------------- | ---------- | ------------------------------------ | ------------------------ | --------------------------------- |
| `durable=true`  | yes        | Unix; Windows has no directory fsync | old or complete new file | old or complete new file on Linux |
| `durable=false` | no         | no                                   | old or complete new file | undefined; may lose old and new   |

`durable=false` is only for disposable or regenerable data. It is never safe as the only copy.
See [versioned-checkpoint.md](versioned-checkpoint.md) for a fast, versioned pattern that keeps
a durable previous generation.

If a durable checkpoint commits the rename but the parent-directory fsync fails,
`index.lastWarning` reports it. The save is not reported as failed because the new file is
already visible; failing the call would invite a destructive retry.

## Platform status (2026-10)

| Target        | Compile check | Runtime smoke | Notes                                                                       |
| ------------- | ------------- | ------------- | --------------------------------------------------------------------------- |
| Linux x64     | yes           | yes           | packaged Electron smoke passes                                              |
| Linux arm64   | `cargo check` | no            | needs a real arm64 smoke                                                    |
| Windows x64   | `cargo check` | no            | rename uses `MoveFileExW` with `MOVEFILE_WRITE_THROUGH`; runtime unverified |
| Windows arm64 | `cargo check` | no            | runtime unverified                                                          |
| macOS x64     | `cargo check` | no            | runtime and physical-fsync semantics unverified                             |
| macOS arm64   | `cargo check` | no            | runtime and physical-fsync semantics unverified                             |

## Windows rename

The Windows checkpoint path uses `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING |
MOVEFILE_WRITE_THROUGH` instead of `std::fs::rename`. The existing retry for transient
`ERROR_ACCESS_DENIED` and `ERROR_SHARING_VIOLATION` remains. Windows still has no directory
fsync; NTFS metadata journaling is the remaining platform boundary.

## macOS

The code compiles for both macOS targets, but no macOS runtime test has been run. Before
claiming power-loss durability on macOS, verify that `File::sync_all()` meets the required
`F_FULLFSYNC` semantics on the target hardware and filesystem. A packaged Electron smoke on
macOS is also still required.
