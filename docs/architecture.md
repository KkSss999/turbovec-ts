# Architecture

## Decision

The package is a JS/TS API backed by a bundled Rust sidecar.

```text
consumer application
  │
  ├── JS/TS import
  ▼
turbovec-ts package
  ├── platform sidecar binary
  ├── spawn / ready / shutdown
  ├── checkpoint-based crash recovery
  ├── framed stdio transport
  ├── pending-request map
  ├── per-instance mutation queue
  └── error mapping
        │
        ▼
turbovecd (Rust process)
  └── turbovec-service
        └── turbovec core
```

## Why B1

The product requirement is:

```ts
import { TurboQuantIndex } from 'turbovec-ts';
```

with no Rust toolchain, no native compilation, and no consumer-written adapter.

B1 keeps the index/search runtime in a real Rust process while the npm package owns the
lifecycle and private transport. Consumers can still put HTTP/gRPC/MCP/CLI layers around the
imported API, but they do not have to implement the turbovec boundary.

## Ownership

| Concern | Owner |
|---|---|
| JS/TS API | this package |
| sidecar binary | this package |
| sidecar lifecycle | this package |
| sidecar protocol | this package, private |
| index/search runtime | Rust sidecar |
| HTTP/gRPC/MCP/server | consumer |
| auth, tenancy, business routing | consumer |
| id mapping for application records | consumer |

## Transport

The sidecar uses framed stdio:

```text
u32 header length
JSON control header
raw payload bytes
```

Vectors and results are raw little-endian typed-array bytes. The transport is private and may
change with the package version. It is not a public API.

## Concurrency

The sidecar processes requests sequentially and uses Rust rayon inside search. The JS client
keeps a pending-request map and can pipeline requests. Bulk mutations are serialized per index
instance; on a failed chunk the client rolls back committed chunks. The sidecar remains the
single index owner, but a process crash cannot be rolled back in memory: pending requests reject
with `ERR_TURBOVEC_IO` and callers reload the last checkpoint. Consumers that need admission
control should add it in their application around the package API.

## Platform policy

Supported by bundled binaries:

```text
linux-x64
linux-x64-musl
win32-x64
darwin-arm64
```

Explicitly unsupported:

```text
linux-arm64
win32-arm64
darwin-x64
```

Compilation on another target is not a support claim.
