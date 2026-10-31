# Service-mode migration

Status: proposed, first phase started. The N-API binding remains the working adapter until the
service reaches parity.

## Decision

Move index ownership, search, persistence, and backpressure into a long-lived Rust process.
The Node/Electron side becomes a thin client.

This is the B option from the benchmark review:

```text
Node / Electron / TypeScript
        │  framed local IPC
        ▼
turbovecd (Rust)
        ├── owns the index
        ├── owns the rayon search pool
        ├── owns the bounded request queue
        ├── owns checkpoint / sync
        └── owns crash recovery and lifecycle
```

The N-API binding is not deleted in this phase. It stays as the compatibility path and as the
control for the IPC benchmark.

## Python SDK is not a counter-example

The Python SDK does run its index and search in Rust, but through PyO3 as an in-process native
extension (`turbovec-python/Cargo.toml`, `pyo3`, `abi3-py39`). CPython still owns the process,
the GIL, object lifetime, and the event loop. Python's integration has to work around GIL and
fork behavior; it is not a separate Rust service.

So Python proves that an in-process Rust extension can be fast and safe. It does not prove that
a service is required. Service mode is chosen for Node because we want:

- the index to survive Node heap pressure and event-loop stalls
- a bounded queue instead of unbounded `spawn_blocking` work
- one owner for large index memory and persistence
- the same Rust process to serve multiple Node/Electron clients later

## Transport

Production target:

- Unix domain socket on Linux and macOS
- Windows named pipe on Windows

The path is supplied by the client. No TCP port is opened. If a temporary TCP loopback spike is
used before named pipes are ready, it must bind `127.0.0.1:0` only, require a random handshake
token, and never be enabled by default.

## Protocol

One frame:

```text
u32 little-endian header length
UTF-8 JSON header (version, id, op, payload length, arguments)
payload bytes (optional)
```

The header is control data. Vectors, ids, scores, and masks are raw little-endian typed-array
bytes, never base64 or JSON arrays.

Request operations:

- `hello` — protocol version, service version, dim, bit width
- `add` — flat f32 vectors
- `add_ids` — flat f32 vectors plus u64 ids
- `search` — queries, k, optional mask
- `search_ids` — queries, k, optional allowlist
- `calibrate`
- `prepare`
- `checkpoint` / `sync`
- `stats`
- `shutdown`

Response:

- JSON header with `ok`, `id`, `payloadBytes`, optional `code` / `message`
- payload for scores, indices, ids, or stats

Errors use the existing `ERR_TURBOVEC_*` code vocabulary. The Node client maps them to
`TurbovecError`.

## Lifecycle

- The Node client starts `turbovecd`, waits for a `hello`, and keeps the connection.
- One service owns one index in phase 1. Multiple indexes/connections come later.
- The service exits on `shutdown`, parent death, or a fatal protocol error.
- The client has a bounded in-flight limit and a request timeout. It never spawns one native
  task per request without a limit.
- A service crash is reported to the client; restart is explicit and replays no writes unless
  the caller chooses to reconnect.
- Checkpoint remains the responsibility of the service; the Node process never holds the
  index buffer.

## Backpressure

The service has one bounded queue:

- max queued requests
- max batch bytes
- max in-flight search tasks
- request deadline and cancellation on disconnect

The Node client also applies a small semaphore so a single client cannot fill the service queue
with unbounded work. The benchmark's full-shape result is the reason: throughput saturates
around 4 concurrent requests while p99 grows from about 7 ms to 300 ms at 64.

## Migration phases

### Phase 0 — vertical slice

- Rust `turbovecd` with one `TurboQuantIndex`
- `hello`, `add`, `search`, `checkpoint`, `stats`, `shutdown`
- Unix socket; Windows named pipe behind the same protocol
- Node client for those operations
- Integration test: spawn service, add, search, checkpoint, restart, load
- IPC benchmark: one-query and 100-query batches vs the current N-API binding

Do not add IdMap, masks, calibration, package publishing, or Electron cutover in this phase.

### Phase 1 — parity

- `IdMapIndex`, masks and allowlists
- calibration and prepare
- all durability options
- error code parity
- lifecycle tests: crash, restart, disconnect, parent death
- backpressure limits and timeout behavior

### Phase 2 — product integration

- Electron sidecar packaging (`extraResources`, signing, notarization)
- platform service binaries
- Node package entry that prefers the service and can fall back to N-API
- migration guide for existing users

### Phase 3 — cutover

- remove N-API only after the service passes the full parity and packaging matrix
- rename release artifacts from the current `turbovec-ts` binding story to the service/client
  product if needed

## Acceptance gates

The migration is not accepted because it is cleaner. It must win on the target workload:

- 100-query batch end-to-end service latency is within 10% of the in-process binding, or
  better under concurrency.
- Single-query p99 does not lose more than 1 ms at the target index size.
- Node RSS no longer grows with index size.
- Service p99 stays bounded under the configured queue; no 300 ms tail from unbounded
  concurrency.
- Crash/restart and parent-death tests pass on Linux x64, macOS arm64, and Windows x64.
- Electron packaged smoke passes with the sidecar.
- Raw benchmark JSON is committed before cutover.

## Risks

- Local IPC adds a copy and a process boundary; small single-query latency may regress.
- Sidecar packaging and signing are harder than an npm native addon.
- Two processes mean two failure domains, logs, health checks, and update paths.
- Windows named pipe and macOS code-signing behavior need real hardware tests.
- A service is not automatically faster; the benchmark decides.

## First implementation target

Build the Phase 0 slice behind the protocol above, run it against the same data as
`docs/benchmarks.md`, and commit the IPC comparison before changing the default package entry.
