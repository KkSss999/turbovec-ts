# Using turbovec-service from pmem

`pmem` is a Node/TypeScript application. It cannot `import` this Rust crate directly, and this
project intentionally does not ship a Node binding, HTTP server, or IPC protocol. pmem must own a
small adapter and its transport.

The recommended shape is a long-lived Rust sidecar:

```text
pmem (Node/TS)
  │  spawn + JSON lines / stdio, or pmem-owned HTTP / named pipe
  ▼
pmem-turbovec-sidecar (Rust)
  │
  ▼
turbovec-service ── turbovec core
```

`consumers/pmem-sidecar/` is a working template for that adapter.

## 1. Add the Rust dependency

For local development with the sibling checkout:

```toml
# pmem/native/pmem-turbovec/Cargo.toml
[dependencies]
turbovec-service = { path = "../../../turbovec-node" }
```

For a pinned git dependency:

```toml
[dependencies]
turbovec-service = { git = "https://github.com/KkSss999/turbovec-ts", rev = "<commit>" }
```

Use a commit or tag, not `main`, for a shipped pmem build. The crate's core dependency is now the
crates.io `turbovec` package, so pmem does not need a sibling core checkout.

## 2. Map pmem chunks to stable ids

pmem's `semantic_chunks` table has string chunk ids. `turbovec-service::IndexKind::IdMap` needs
`u64` ids.

Pick one mapping and keep it in pmem's SQLite schema:

- a monotonic `u64` assigned when a chunk is first indexed, or
- a documented stable hash with collision detection.

Do not derive a bare 64-bit hash and assume no collision. Keep the string-id ↔ u64 mapping
inspectable, because search returns ids and pmem must hydrate the original chunk rows.

## 3. Rebuild and search

Suggested pmem flow:

1. `pmem semantic rebuild` reads current chunk embeddings from SQLite.
2. Send `add` batches to the sidecar with the mapped u64 ids.
3. Optionally `save` a `.tvim` checkpoint under `.pmem/`.
4. `pmem ask` embeds the query, sends `search`, receives chunk ids and scores.
5. pmem hydrates the chunk rows from SQLite and applies its existing evidence/quality gates.

Keep SQLite as the canonical chunk/vector store. The turbovec index is a derived acceleration
structure and must be rebuildable. Do not delete the SQLite vectors after building the sidecar
index.

## 4. Transport stays in pmem

The template uses JSON lines over stdio because it is easy to debug. Production options:

- stdio for a CLI-spawned sidecar
- a pmem-owned Unix socket / Windows named pipe
- a pmem-owned local HTTP/gRPC endpoint

The library does not define any of these. Avoid spawning a new Rust process per query for MCP or
SDK calls; keep one sidecar per project/session and apply a bounded request queue in pmem.

## 5. Packaging

pmem needs to ship the sidecar for its supported targets:

```text
linux-x64
win32-x64
```

Linux arm64 and Windows arm64 are explicitly out of scope. Keep sidecar and root versions
aligned, and package the binary outside the JS bundle (or download it during an explicit setup
step). Do not build native Rust during an npm install.

## Template

Run the example sidecar:

```bash
cargo run --manifest-path consumers/pmem-sidecar/Cargo.toml -- --dim 384 --bits 4
```

Send one JSON object per line:

```json
{"op":"add","ids":[1,2],"vectors":[...]}
{"op":"search","query":[...],"k":10}
{"op":"stats"}
{"op":"save","path":".pmem/semantic.tvim"}
{"op":"shutdown"}
```

The template uses `IdMap` and `Durability::Durable`. pmem owns the id mapping, batching,
persistence policy, retries, and queue.
