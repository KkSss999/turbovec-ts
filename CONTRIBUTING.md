# Contributing

## Requirements

- Bun 1.4.4+
- Rust 1.89+
- Node.js 20.17+
- The sibling `../turbovec/turbovec` core crate

Python is only needed for the optional format-interop tests.

## Setup

```bash
bun install
bun run build:debug
```

Use Bun for dependency installation and scripts. Do not commit `node_modules/`, `target/`,
native build outputs, `.npmrc`, or generated `native.*` files.

## Checks

```bash
bun run check          # format, lint, typecheck
bun run test           # TypeScript/native suite
bun run release:check  # version, file, and package consistency
```

When changing the on-disk format boundary, run the strict Python check:

```bash
TURBOVEC_PYTHON=/path/to/venv/bin/python bun run test:interop
```

When changing Rust or the native boundary, also run:

```bash
bun run build:debug
bun run smoke:electron   # Linux x64 reference smoke
```

## Platform changes

Do not claim a platform is supported because it compiles. A platform is supported only after a
real load, CRUD/search, persistence, and packaged integration smoke on that target. Record the
result in `docs/durability.md` and the changelog.

## API and tests

- Keep the public surface documented in `index.d.ts` and `docs/api-stability.md`.
- New behavior needs a test that can fail without the change.
- Add user-visible changes to `CHANGELOG.md` under `Unreleased` or the next version.
- Do not add CI, release automation, or npm publication without explicit maintainer approval.

## Pull requests

Keep changes focused. Explain the user-visible behavior, the tests run, and any platform or
durability caveat. Do not include secrets or generated binaries.
