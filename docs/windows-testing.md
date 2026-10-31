# Windows x64 testing from WSL2

WSL2 can drive the Windows Rust and Node toolchains through interop. Build and run from a Windows
filesystem path; do not use a UNC path as the current directory.

## Setup

Verify from WSL:

```bash
cmd.exe /c ver
powershell.exe -NoProfile -Command 'cargo --version; node --version'
```

On Windows, Rust MSVC and Visual Studio Build Tools must be installed for building the sidecar.
Consumers of the npm package do not need either.

## Sync source to Windows

```bash
rm -rf /mnt/g/RustTemp/turbovec-node
rsync -a --exclude target --exclude .git /home/kerye/turbovec-node/ /mnt/g/RustTemp/turbovec-node/
```

## Build sidecar

```bash
powershell.exe -NoProfile -Command "Set-Location 'G:\RustTemp\turbovec-node'; cargo build --release --bin turbovecd"
```

Copy the result into the package tree:

```bash
cp /mnt/g/RustTemp/turbovec-node/target/release/turbovecd.exe \
   /home/kerye/turbovec-node/bin/win32-x64/turbovecd.exe
```

## Run tests and package client

```bash
powershell.exe -NoProfile -Command "Set-Location 'G:\RustTemp\turbovec-node'; cargo test --locked --all-targets"
```

Client smoke on Windows:

```bash
powershell.exe -NoProfile -Command "Set-Location 'G:\RustTemp\turbovec-node'; node -e \"const { TurboQuantIndex } = require('./index.cjs'); (async()=>{ const i=new TurboQuantIndex(8,4); await i.add(new Float32Array([1,0,0,0,0,0,0,0])); const r=await i.search(new Float32Array([1,0,0,0,0,0,0,0]),1); console.log(r.indices); await i.close(); })().catch(e=>{console.error(e); process.exit(1)})\""
```

## Verified

On 2026-10-31 on Windows x64:

- Rust sidecar test suite: 11 integration tests passed
- `cargo clippy --all-targets -- -D warnings`: clean
- packaged JS client: sidecar spawn, add, search, close passed
- package tarball: Linux x64 installed and imported with no Rust invocation

The package does not ship a Windows arm64 binary.
