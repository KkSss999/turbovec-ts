# turbovec-ts

TypeScript/Node.js bindings for [turbovec](https://github.com/RyanCodrai/turbovec), a Rust
vector index with 2-4 bit quantization and SIMD search.

## Status

**0.1.1, prepared release candidate. Not published.**

The `0.1.x` public API is frozen for patch releases; additions are allowed, but a breaking
change requires a minor bump and a deprecation path. See
[`docs/api-stability.md`](docs/api-stability.md).

- No CI, GitHub Actions, or release automation until 1.0.0.
- No npm publication until explicitly approved. `"private": true` is an intentional guard.
- Local checks are the gate: `bun run check`, `bun run test`, `bun run release:check`, and a
  native build.
- Linux x64 is built, tested, and packaged, including a packaged Electron app.
- Linux arm64, Windows x64/arm64, and macOS x64/arm64 compile but are not yet runtime-supported;
  see [`docs/durability.md`](docs/durability.md).
- Release steps and the artifact matrix live in [`docs/release.md`](docs/release.md).

## Requirements

- Bun 1.4.4+
- Rust 1.89+
- Node.js 20.17+
- The sibling turbovec core at `../turbovec/turbovec` for development

## Build and test

```bash
bun install
bun run build:debug
bun run check
bun run test
bun run release:check
```

Release-style build:

```bash
bun run build
```

## Current API

```ts
import { TurboQuantIndex } from 'turbovec-ts';

const index = new TurboQuantIndex(8, 4);

await index.add(vectors);
const result = await index.search(query, 1);

await index.swapRemove(0); // moves the last slot into slot 0
index.clear(); // reset to an empty index with the same dim/bit width

index.serializedLength; // exact bytes toBytes() will return

const bytes = index.toBytes();
const restored = TurboQuantIndex.fromBytes(bytes);
```

Stable external ids use `IdMapIndex`:

```ts
import { IdMapIndex } from 'turbovec-ts';

const index = new IdMapIndex(8, 4);
const ids = new BigUint64Array([10n, 20n, 30n]);

await index.addWithIds(vectors, ids);
const result = await index.search(query, 2);
const filtered = await index.search(query, 2, new BigUint64Array([10n, 30n]));

await index.remove(10n);
index.contains(20n);
index.iterIds(); // BigUint64Array in slot order
index.clear(); // reset to an empty id map
```

`add`, `addWithIds`, `remove`, and `search` return promises. `contains`, `toBytes`, and
`fromBytes` are synchronous.

### Persistence and calibration

```ts
await index.write('index.tv'); // durable by default
await index.write('index.tv', false); // skip fsync

const loaded = await TurboQuantIndex.load('index.tv');

await index.calibrate(sample);
await index.prepare();
index.calibrationState; // 'uncalibrated' | 'calibrated'
```

`sync(path)` writes only the change since the previous sync and is available on both index
types. `IdMapIndex` uses `.tvim` files.

`checkpoint(path)` writes a full snapshot by streaming directly to a temp file under the read
lock, then releasing it for fsync and rename. Searches continue during the write; mutations
wait while the snapshot is being written. It is not incremental and does not bind the index to
the path. Stale `<name>.tmp.<pid>.<seq>` siblings older than one hour are removed best-effort
before a new checkpoint. Concurrent checkpoints to one path each use a unique temp file; the
last rename wins and the result is one complete snapshot, never a mix.

`durable=false` on `write` or `checkpoint` is fast but only process-crash safe. It skips fsync, so after a power loss the
checkpoint is undefined: the new file may be missing or truncated, and the previous file may
also be lost. Use it only for disposable or regenerable data, never as the only copy. See
[`docs/versioned-checkpoint.md`](docs/versioned-checkpoint.md) for a crash-safe fast pattern
built from the public primitives.

A durable checkpoint can still succeed with a durability warning: if the file was renamed but
the parent-directory fsync failed, `index.lastWarning` contains a message. The file is visible
and complete, but the rename may not survive power loss.

Locking:

- `write` and `checkpoint` take the read lock: searches continue, mutations wait.
- `sync` takes the write lock: searches and mutations wait until it finishes.
- `clear`, `dispose`, `add`, `remove`, and `swapRemove` take the write lock.

A write queue would not remove that pause because the core `sync(&mut self)` needs exclusive
access. See [`docs/sync-lock.md`](docs/sync-lock.md) for the decision and alternatives.

`dispose()` releases the native index. Later calls fail with an `ERR_TURBOVEC_DISPOSED`
message prefix. `isDisposed` reports the state.

`estimatedBytes` is a rough resident-size estimate for the compressed codes, scales,
calibration, ids, and headers. It excludes allocator overhead, SIMD caches, and transient
scratch buffers; use it for monitoring and guardrails, not exact accounting.
`serializedLength` is exact and available on both index types.

After mutations the wrapper reports the estimate to V8 through
`napi_adjust_external_memory`, so the JavaScript GC can account for the native index
instead of seeing only the small JS handle.

Native methods throw or reject with `TurbovecError` automatically:

```ts
import { TurbovecError } from 'turbovec-ts/errors';

try {
  await index.search(query, 10);
} catch (error) {
  if (error instanceof TurbovecError) {
    console.log(error.code); // ERR_TURBOVEC_DISPOSED, ERR_TURBOVEC_IO, ...
  }
}
```

`toTurbovecError(error)` is still available for mapping errors that did not come through
the native wrapper.

### Python interop tests

Python is not a runtime dependency and is not shipped in the npm package. It is only a second
implementation used to verify the on-disk format.

`bun run test` runs the TypeScript/native suite only. The strict interop check requires an
explicit interpreter and refuses to run if the Python `turbovec` version differs from the Rust
core in `Cargo.lock`:

```bash
TURBOVEC_PYTHON=/path/to/venv/bin/python bun run test:interop
```

## Benchmarks

```bash
bun run bench
```

Compares the wrapped public API against the generated native loader on a synthetic
10K x 1536 index. Use it to check that the error-wrapping Proxy stays within noise on
your machine.

## Electron

Use a `utilityProcess` that owns the index; the renderer talks over narrow IPC. See
[`examples/electron/README.md`](examples/electron/README.md) for the architecture and
[`examples/electron-app/README.md`](examples/electron-app/README.md) for a packaged smoke
test that builds and runs the app.

## Documentation

- API stability: [`docs/api-stability.md`](docs/api-stability.md)
- Release process: [`docs/release.md`](docs/release.md)
- Durability and platforms: [`docs/durability.md`](docs/durability.md)
- Versioned checkpoints: [`docs/versioned-checkpoint.md`](docs/versioned-checkpoint.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)

## License

MIT. The native addon links the turbovec core, also MIT; see [LICENSE](LICENSE) and
[`LICENSE-TURBOVEC`](LICENSE-TURBOVEC).
