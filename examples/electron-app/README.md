# Packaged Electron smoke test

This example packages a minimal Electron app with `@electron/packager`, loads
`turbovec-ts` inside a `utilityProcess`, and exits with a non-zero code unless the
worker returns the expected id.

## Setup

```bash
cd ../..
bun run build
cd examples/electron-app
bun install
```

On Linux, Electron needs the usual Chromium system libraries. On Ubuntu, for example:

```bash
sudo apt-get install libnspr4 libnss3 libasound2t64
```

If those libraries are installed in a non-standard prefix, point `LD_LIBRARY_PATH` at
them before running the packaged binary.

## Run

```bash
bun run smoke
```

Expected output:

```text
SMOKE_MESSAGE {"ok":true,"id":"42","length":1}
SMOKE_EXIT 0
```

The app is written to `dist/turbovec-smoke-linux-x64/`. It is packaged with ASAR and
unpacks `.node` files through `--asar.unpack=**/*.node`.

## What it verifies

- the packaged ASAR layout loads the `.node` addon
- `utilityProcess` can require `turbovec-ts`
- `IdMapIndex` adds and searches in a separate process
- `dispose()` runs before the worker exits
- the app exits 0 only when the result is correct
