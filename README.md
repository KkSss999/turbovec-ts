# turbovec-ts

Node.js API for [turbovec](https://github.com/RyanCodrai/turbovec), backed by a bundled Rust
sidecar. Consumers install the package, import the API, and do not need a Rust toolchain.

## Status

**0.3.0, pre-release. Not published.**

- JavaScript/TypeScript API in `index.js` / `index.cjs` / `index.d.ts`
- Rust runtime in the bundled `turbovecd` sidecar
- The package starts, owns, and stops the sidecar
- No consumer-written Rust, no consumer-written IPC
- Consumers who need HTTP/gRPC/MCP/server layers write those in their own application

Platform binaries currently bundled:

```text
linux-x64
win32-x64
darwin-arm64
```

Linux arm64, Windows arm64, macOS x64, and Linux musl are explicitly unsupported.

## Install

The package is not published yet. From a local checkout/tarball:

```bash
bun add /absolute/path/to/turbovec-ts-0.3.0.tgz
```

```ts
import { TurboQuantIndex } from 'turbovec-ts';

const index = new TurboQuantIndex(768, 4);
await index.add(vectors);
const result = await index.search(queries, 10);
await index.close();
```

`TurboQuantIndex` and `IdMapIndex` are process-backed: the package finds the sidecar binary,
starts it, and speaks a private framed protocol. Consumers do not see or manage that protocol.

## API

| Type | Purpose |
|---|---|
| `TurboQuantIndex` | Dense positional index |
| `IdMapIndex` | Dense index with stable `u64` ids |
| `IndexStats` | kind, dim, bits, length, serialized/estimated bytes |
| `TurbovecError` | sidecar/native error with a stable code |

Dense methods: `add`, `swapRemove`, `search` (optional byte mask), `checkpoint`/`write`, `sync`,
`calibrate`, `prepare`, `stats`, `close`, static `load`.

Id-map methods: `addWithIds`, `search` (optional allowlist), `remove`, `contains`, `iterIds`,
`checkpoint`/`write`, `sync`, `calibrate`, `prepare`, `stats`, `close`, static `load`.

All index operations are asynchronous because they cross the sidecar process boundary. Bulk
`add`/`addWithIds` calls are chunked; a failure after an earlier chunk can leave a committed
prefix, so rebuild or clear before retrying a failed bulk load.

## Architecture

```text
consumer JS/TS
  └── turbovec-ts (JS client, spawn/lifecycle/framing)
        └── turbovecd (Rust process)
              └── turbovec-service
                    └── turbovec core
```

The library does not ship an HTTP/gRPC/CLI server and does not define a public wire protocol.
Server and IPC exposure are consumer-owned. The package-owned sidecar transport is private.

See [`docs/architecture.md`](docs/architecture.md).

## Development

```bash
cargo test
cargo build --release --bin turbovecd
cp target/release/turbovecd bin/linux-x64/turbovecd

bun test
bun pm pack --filename turbovec-ts-0.3.0.tgz
```

Windows x64 uses `target/release/turbovecd.exe` copied to `bin/win32-x64/`. macOS arm64 uses
`target/release/turbovecd` copied to `bin/darwin-arm64/`.

## Documentation

- Architecture: [`docs/architecture.md`](docs/architecture.md)
- API stability: [`docs/api-stability.md`](docs/api-stability.md)
- Durability: [`docs/durability.md`](docs/durability.md)
- Windows testing: [`docs/windows-testing.md`](docs/windows-testing.md)
- Benchmark: [`docs/benchmarks.md`](docs/benchmarks.md)
- Release process: [`docs/release.md`](docs/release.md)

## License

MIT. The sidecar links the turbovec core, also MIT; see [`LICENSE`](LICENSE) and
[`LICENSE-TURBOVEC`](LICENSE-TURBOVEC).
