# turbovec-ts

TypeScript/Node.js bindings for [turbovec](https://github.com/RyanCodrai/turbovec), a Rust
vector index with 2-4 bit quantization and SIMD search.

## Status

**Pre-alpha, version 0.0.1.** The API is unstable and may change without notice. This is
below the first planned public milestone, 0.1.0.

- No CI, GitHub Actions, or release automation until 1.0.0.
- No npm publication until explicitly approved.
- Local checks are the gate: `bun run check`, `bun test`, and a native build.
- Linux x64 has been built and smoke-tested, including a packaged Electron app. Other
  platforms are unverified.

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
bun test
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

Locking:

- `write` takes the read lock: searches continue, mutations wait.
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

The interop tests are skipped when `python3` cannot import `turbovec`. Point them at a
Python environment that has the package:

```bash
TURBOVEC_PYTHON=/path/to/venv/bin/python bun test
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

## License

MIT. See [LICENSE](LICENSE).
