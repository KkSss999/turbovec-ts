# Release process

`0.1.1` is prepared but **not published**. `package.json` intentionally keeps `"private": true`
as a publish guard. Remove it only at the moment of an approved release.

## Version policy

- Version lives in `package.json`, `Cargo.toml`, `Cargo.lock`, and platform package manifests.
- Keep all of them identical.
- Update `CHANGELOG.md` before building release artifacts.
- See [api-stability.md](api-stability.md).

## Preflight

```bash
bun run release:check
bun run check
bun run test
TURBOVEC_PYTHON=/path/to/venv/bin/python bun run test:interop
bun run build
```

`release:check` validates versions, required release files, optional platform dependencies, and
generated platform package versions when `npm/` exists. The package `prepack` hook also runs it.

## Artifact matrix

| npm suffix         | Rust target                 | Status                  |
| ------------------ | --------------------------- | ----------------------- |
| `linux-x64-gnu`    | `x86_64-unknown-linux-gnu`  | built, tested, packaged |
| `linux-arm64-gnu`  | `aarch64-unknown-linux-gnu` | compile-checked only    |
| `win32-x64-msvc`   | `x86_64-pc-windows-msvc`    | compile-checked only    |
| `win32-arm64-msvc` | `aarch64-pc-windows-msvc`   | compile-checked only    |
| `darwin-x64`       | `x86_64-apple-darwin`       | compile-checked only    |
| `darwin-arm64`     | `aarch64-apple-darwin`      | compile-checked only    |

No musl targets are built yet.

## Build and stage

The exact cross toolchain differs per host. Build the target, then let napi create/copy the
platform packages:

```bash
bunx napi create-npm-dirs
bunx napi version

# Repeat for each matrix row. Build the addon directly into its platform package so
# napi pre-publish can validate and stage it. The platform package only ships the .node.
bunx napi build --platform --release \
  --target x86_64-unknown-linux-gnu \
  --output-dir npm/linux-x64-gnu \
  --no-js

bunx napi pre-publish --dry-run
```

`napi pre-publish` validates every platform package, updates the root optional dependencies,
and stages the release. It fails if any target's `.node` is missing, which is intentional.
Inspect the generated `package.json` files before publishing. napi creates platform packages
with only the `.node` in `files`; copy `LICENSE` and `LICENSE-TURBOVEC` into each platform
directory and add them to its `files` list so the binary distribution carries the notices.

## Tarball test

Before any publish:

```bash
bun pm pack --dry-run
bun pm pack
mkdir -p /tmp/turbovec-ts-install && cd /tmp/turbovec-ts-install
printf '{"name":"tv-install-test","private":true}\n' > package.json
bun add /absolute/path/to/turbovec-ts-0.1.1.tgz
node -e "const { TurboQuantIndex } = require('turbovec-ts'); const i = new TurboQuantIndex(8, 4); console.log(i.dim, i.bitWidth); i.dispose()"
```

Repeat on every supported target and with a packaged Electron app. Verify the optional platform
package is installed and that its version matches the root package.

## Publish order

Only after explicit approval:

1. Remove `"private": true` and rerun `bun run release:check`.
2. Publish the six platform packages first with `bun publish` from each `npm/<platform>` directory.
3. Publish the root `turbovec-ts` package with `bun publish`.
4. Create the git tag and GitHub release from the same commit.
5. Run the tarball and packaged-app smoke against the registry artifact.

`napi pre-publish` uses `napi.npmClient`, currently `bun`. Do not publish from this repository as
part of normal development.

## Rollback

Do not rely on unpublishing. If a release is broken, deprecate the version with a message and
publish a patch. Keep the platform package versions aligned with the root package.
