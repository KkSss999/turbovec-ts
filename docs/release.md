# Release process

`0.3.1` was released manually (after `0.3.0`). `Cargo.toml` keeps `publish = false`; this project ships the npm package, not a crates.io package.

## Preflight

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo doc --no-deps
bun test
bun scripts/soak.mjs
```

## Sidecar binaries

Build and stage the platform binaries before packing:

```bash
cargo build --release --bin turbovecd
cp target/release/turbovecd bin/linux-x64/turbovecd
```

On Windows:

```powershell
cargo build --release --bin turbovecd
Copy-Item target\release\turbovecd.exe bin\win32-x64\turbovecd.exe
```

The package must contain:

```text
bin/linux-x64/turbovecd
bin/linux-x64-musl/turbovecd
bin/win32-x64/turbovecd.exe
bin/darwin-arm64/turbovecd
```

macOS arm64 is built and smoke-tested on the arm64 Mac. Rust emits an ad-hoc linker signature;
the artifact is not notarized. A Developer ID certificate and `notarytool` credentials are
required for distribution notarization and are not present in this repository.

## Package smoke

```bash
bun pm pack --filename turbovec-ts-0.3.1.tgz
mkdir -p /tmp/turbovec-ts-install && cd /tmp/turbovec-ts-install
printf '{"name":"tv-install","private":true}\n' > package.json
bun add /absolute/path/to/turbovec-ts-0.3.1.tgz
node --input-type=module -e "import { TurboQuantIndex } from 'turbovec-ts'; const i=new TurboQuantIndex(8,4); await i.add(new Float32Array([1,0,0,0,0,0,0,0])); console.log((await i.search(new Float32Array([1,0,0,0,0,0,0,0]),1)).indices); await i.close();"
```

The smoke must pass without invoking Rust. The package contains prebuilt sidecars; no install
script compiles anything.

## Publish

Only after approval:

1. Bump the package and Cargo versions together.
2. Rebuild all platform sidecars from the same commit.
3. Pack and run the tarball smoke.
4. Push the release commit and tag.
5. Publish with `bun publish`.
6. Create the GitHub release and attach the tarball.

Do not add a server or consumer adapter to make a release possible.
