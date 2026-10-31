# Windows x64 testing from WSL2

WSL2 can drive the Windows Rust toolchain through interop. The Windows build must run from a
Windows filesystem path; `cargo` and the MSVC linker do not handle a UNC current directory
(`\\wsl.localhost\...`) reliably.

## Prerequisites

On Windows:

- Rust MSVC toolchain (`x86_64-pc-windows-msvc`)
- Visual Studio Build Tools with the MSVC linker and Windows SDK
- `cargo.exe` available in Windows `PATH`

Verify from WSL:

```bash
cmd.exe /c ver
powershell.exe -NoProfile -Command 'cargo --version; rustc -vV'
```

## Copy the repository to a Windows drive

The core is a sibling path dependency, so preserve the layout:

```text
G:\RustTemp\turbovec\turbovec
G:\RustTemp\turbovec-node
```

From WSL:

```bash
rm -rf /mnt/g/RustTemp/turbovec /mnt/g/RustTemp/turbovec-node
rsync -a --exclude target --exclude .git /home/kerye/turbovec/ /mnt/g/RustTemp/turbovec/
rsync -a --exclude target --exclude .git /home/kerye/turbovec-node/ /mnt/g/RustTemp/turbovec-node/
```

## Run the tests

```bash
powershell.exe -NoProfile -Command "Set-Location 'G:\RustTemp\turbovec-node'; cargo test --locked"
```

Expected result: the service integration suite passes on Windows x64. The tests cover dense and
id-map indexes, persistence, malformed input, close semantics, and concurrent searches.

Consumer example:

```bash
powershell.exe -NoProfile -Command "Set-Location 'G:\RustTemp\turbovec-node'; cargo run --manifest-path consumers/cli/Cargo.toml"
```

The Unix-socket IPC example is Unix-only; Windows consumers should use named pipes or another
transport they own.

## Notes

- Re-copy the source after changing the WSL checkout.
- Do not use `\\wsl.localhost\...` as the current directory for Windows `cargo`.
- Build output remains under `G:\RustTemp\turbovec-node\target`; it is not committed.
- This is a real Windows-native test, not a cross-compile check.
