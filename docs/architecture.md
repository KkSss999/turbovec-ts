# Architecture

## Decision

The runtime is Rust, and this repository is a **service-layer library**. It is not a daemon and
does not define a wire protocol.

```text
domain   upstream turbovec core
service  turbovec-service: lifecycle, locking, validation, persistence, stats
api      public Rust API
server   consumer: HTTP / gRPC / CLI / IPC, auth, tenancy, queues
```

Consumers embed the service in their own process, or wrap it in a server they own. This keeps the
runtime with Rust without forcing a transport or a sidecar on every consumer.

## Why not an IPC service

The earlier B proposal put the index in a Rust sidecar and connected Node or other clients over
a local socket. That added:

- a second process and lifecycle
- IPC framing, copying, and versioning
- sidecar packaging, signing, and notarization
- transport-specific error, timeout, and backpressure behavior

Those are application concerns. The benchmark showed the Rust core is fast in-process; the
remaining Node costs were runtime memory and admission control, not a reason to require IPC for
every deployment.

## Relationship to the Python SDK

The upstream Python SDK uses PyO3 as an in-process native extension. Python owns the process and
the API; Rust owns index/search kernels. This crate follows the same layering idea: a language
surface over the Rust domain, with no separate service required.

The difference is that this crate's public surface is Rust. A consumer that needs a Python,
Node, HTTP, or IPC surface should build that adapter around this API.

## Concurrency

`Service` uses an internal read/write lock:

- search: read lock, concurrent searches allowed
- add/remove/calibrate/sync/close: write lock
- write/checkpoint: read lock, full snapshot without a second in-memory image

There is no internal queue. A consumer that needs bounded concurrency must implement it around
the service.

## Persistence

`write`/`checkpoint` produce a full snapshot; `sync` incrementally persists a single-writer
destination. The core owns the on-disk format. One writer per path is the contract.

## Non-goals

- no listener or daemon
- no IPC protocol
- no built-in global semaphore
- no authentication, tenancy, or routing
- no claim that the host process is Rust; the service library is Rust, the host is whatever
  embeds it
