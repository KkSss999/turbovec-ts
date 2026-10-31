# API stability

## Public surface

The public surface is the API exported from `turbovec_service`:

- `Service`, `Config`, `IndexKind`
- `SearchResult`, `Stats`
- `ServiceError`, `ErrorCode`
- `Durability`
- re-exported `SearchResults` and `IdSearchResults`

Anything in `src/` that is not re-exported is internal.

## Version policy

`0.2.x` is a pre-release line. Until `1.0`:

- patch releases should not break the public API
- additions are allowed
- a breaking change requires a minor bump and a changelog entry
- `1.0` freezes the API under normal Semantic Versioning rules

Deprecations should be documented in the changelog and kept for at least one minor release when
practical.

## Semantics

- `ErrorCode` categories are part of the contract.
- One writer per persistence path is required.
- `Service::close` makes later operations return `Disposed`.
- Search locks are implementation details; concurrent searches are supported, but the precise
  lock is not API.
- The on-disk format belongs to the upstream core.

## Transport boundary

This crate will not add a network or IPC API. A consumer may build one, but it is a separate
contract with its own versioning.

## Platform claims

Compilation is not support. Run the integration tests on the target before documenting a
platform as supported.
