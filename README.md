# turbovec-ts

Node.js API for [turbovec](https://github.com/RyanCodrai/turbovec), backed by a bundled Rust
sidecar. Consumers install the package, import the API, and do not need a Rust toolchain.

## Status

**0.3.3, published.**

- JavaScript/TypeScript API in `index.js` / `index.cjs` / `index.d.ts`
- Rust runtime in the bundled `turbovecd` sidecar
- The package starts, owns, and stops the sidecar
- No consumer-written Rust, no consumer-written IPC
- Consumers who need HTTP/gRPC/MCP/server layers write those in their own application

Platform binaries currently bundled:

```text
linux-x64
linux-x64-musl
win32-x64
darwin-arm64
```

Linux arm64, Windows arm64, and macOS x64 are explicitly unsupported. The musl sidecar is a
static-pie binary; the glibc sidecar is the default on glibc systems and the musl sidecar is
selected on musl systems. The macOS arm64 sidecar is signed with the project self-signed
certificate `turbovec-ts Self-Signed` and is not notarized.

## Install

```bash
bun add turbovec-ts
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
`add`/`addWithIds` calls are chunked and serialized per index instance. If a chunk fails while the
sidecar is alive, the client rolls back the chunks it already committed. A sidecar process crash
cannot be rolled back in memory; reload the last checkpoint.

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
bun scripts/soak.mjs
bun pm pack --filename turbovec-ts-0.3.3.tgz
```

`bun test` covers the public smoke path, chunk rollback, concurrent requests, repeated searches,
and checkpoint recovery after a sidecar kill. `scripts/soak.mjs` runs a timed concurrent load and
reports Node and sidecar RSS; set `TURBOVEC_SOAK_SECONDS` to run a longer soak.

Windows x64 uses `target/release/turbovecd.exe` copied to `bin/win32-x64/`. macOS arm64 uses
`target/release/turbovecd` copied to `bin/darwin-arm64/`. The musl sidecar is built with
`x86_64-unknown-linux-musl` and copied to `bin/linux-x64-musl/`.

## Documentation

- Architecture: [`docs/architecture.md`](docs/architecture.md)
- API stability: [`docs/api-stability.md`](docs/api-stability.md)
- Durability: [`docs/durability.md`](docs/durability.md)
- Testing and soak: [`docs/testing.md`](docs/testing.md)
- Windows testing: [`docs/windows-testing.md`](docs/windows-testing.md)
- Benchmark: [`docs/benchmarks.md`](docs/benchmarks.md)
- Release process: [`docs/release.md`](docs/release.md)

## License

MIT. The sidecar links the turbovec core, also MIT; see [`LICENSE`](LICENSE) and
[`LICENSE-TURBOVEC`](LICENSE-TURBOVEC).
