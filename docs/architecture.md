# Architecture

Status: accepted. The project is a library, not a daemon.

## Scope

`turbovec-ts` owns the index runtime inside the host process. It does not ship an HTTP/gRPC
server, a Unix-socket service, a CLI daemon, authentication, multi-tenant routing, or a global
request queue. Those belong to the consumer's application.

This is the same shape as the upstream Python SDK: CPython owns the process and API surface;
PyO3 loads the Rust core in-process for indexing and search. The Python package does not start a
separate Rust service.

## Layers

| Layer                      | Location                                          | Responsibility                                                                                                |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Domain                     | upstream `turbovec` core                          | quantization, SIMD kernels, search, on-disk format                                                            |
| In-process service/adapter | `src/lib.rs`                                      | N-API boundary, index ownership, locks, async offload, persistence, error mapping, external-memory accounting |
| Public API                 | `index.js`, `index.cjs`, `index.d.ts`, `errors.*` | typed-array inputs, BigInt ids, promises, stable errors, CJS/ESM                                              |
| Consumer-owned             | outside the package                               | HTTP/gRPC/CLI/Electron IPC, queues, auth, tenancy, deployment                                                 |

The word "service" here means the in-process orchestration layer. It does not mean a network
service.

## Why library-only

- One process and no IPC serialization.
- No sidecar lifecycle, signing, notarization, named-pipe, or port-management burden.
- Electron can keep the index in a `utilityProcess` and use narrow IPC, as the example does.
- A consumer that wants HTTP/gRPC can wrap the public API without this package imposing a
  protocol.
- It matches the upstream Python SDK's in-process PyO3 model.

The tradeoff is that the host runtime owns the memory and the request queue. The SDK exposes the
index; the consumer decides how many requests to admit and what transport to expose.

## Backpressure

The SDK returns promises, but it does not impose a global in-flight limit. A consumer must:

- cap concurrent `search`/`add` calls,
- batch queries where possible,
- keep one writer per index path,
- decide whether to run the index in a worker/utility process.

The benchmark report shows why: at 100K x 1536 the Rust core saturates throughput around four
concurrent requests while p99 grows sharply with more. That limit belongs to the application's
latency budget, not to a hidden global queue in the library. See `docs/benchmarks.md`.

## Deployment patterns

### Electron

The index lives in a `utilityProcess`; the renderer talks to it through preload and narrow IPC.
This is already demonstrated in `examples/electron-app/`.

### HTTP/gRPC

The application owns the server and its admission control:

```ts
const index = new TurboQuantIndex(1536, 4);
await index.add(vectors);

// A bounded queue lives here, not in the SDK.
app.post('/search', async (request, reply) => {
  const result = await index.search(query, 10);
  return { indices: result.indices, scores: Array.from(result.scores) };
});
```

### CLI

A CLI is a consumer script around the library. Persistence uses `write`/`sync`/`checkpoint`;
`toBytes`/`fromBytes` are available when the application owns the storage layer.

## Non-goals

- no listener or socket inside the package
- no daemon process
- no built-in global semaphore
- no auth, tenancy, or routing
- no claim that the host runtime is Rust; Rust owns the index/search core, the host owns the
  process

## Rejected alternative

The earlier service-mode proposal moved the index into a Rust sidecar and added local IPC. It is
recorded in `docs/service-migration.md` as a rejected design. It was useful for evaluating
isolation and backpressure, but it adds a second process, packaging/signing work, and IPC cost
without being required for the library's consumers.
