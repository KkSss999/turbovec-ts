# turbovec-ts

TypeScript/Node.js bindings for [turbovec](https://github.com/RyanCodrai/turbovec), a Rust
vector index with 2-4 bit quantization and SIMD search.

## Status

**Pre-alpha, version 0.0.1.** The API is unstable and may change without notice. This is
below the first planned public milestone, 0.1.0.

- No CI, GitHub Actions, or release automation until 1.0.0.
- No npm publication until explicitly approved.
- Local checks are the gate: `bun run check`, `bun test`, and a native build.
- Only Linux x64 has been built and smoke-tested locally. Other platforms are unverified.

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
types. `IdMapIndex` uses `.tvim` files. `sync` takes the exclusive index lock, so searches
wait while a sync is writing.

`dispose()` releases the native index. Later calls fail with an `ERR_TURBOVEC_DISPOSED`
message prefix.

Native errors carry a stable `ERR_TURBOVEC_*` prefix in the message (for example
`ERR_TURBOVEC_IO`, `ERR_TURBOVEC_NATIVE`, `ERR_TURBOVEC_INVALID_INPUT`). Map them to a
typed error with the helper:

```ts
import { TurbovecError, toTurbovecError } from 'turbovec-ts/errors';

try {
  await index.search(query, 10);
} catch (cause) {
  const error = toTurbovecError(cause);
  if (error instanceof TurbovecError) {
    console.log(error.code); // ERR_TURBOVEC_DISPOSED, ERR_TURBOVEC_IO, ...
  }
}
```

### Python interop tests

The interop tests are skipped when `python3` cannot import `turbovec`. Point them at a
Python environment that has the package:

```bash
TURBOVEC_PYTHON=/path/to/venv/bin/python bun test
```

## License

MIT. See [LICENSE](LICENSE).
