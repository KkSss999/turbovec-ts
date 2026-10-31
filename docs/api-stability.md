# API stability

## Public surface

The public API is the JavaScript/TypeScript package:

- `TurboQuantIndex`
- `IdMapIndex`
- `TurbovecError`, `toTurbovecError`
- the result and stats types in `index.d.ts`

The sidecar binary, framed stdio protocol, request ids, payload layout, and sidecar process
management are implementation details. They may change between package versions without a
public API break.

## 0.3.x surface

`TurboQuantIndex` methods: `add`, `swapRemove`, `search`, `checkpoint`, `write`, `sync`,
`calibrate`, `prepare`, `stats`, `close`, `dispose`, and static `load`.

`IdMapIndex` methods: `addWithIds`, `search`, `remove`, `contains`, `iterIds`, `checkpoint`,
`write`, `sync`, `calibrate`, `prepare`, `stats`, `close`, `dispose`, and static `load`.

Properties: `dim`, `bitWidth`.

This surface is frozen for `0.3.x`: patch releases may add methods but must not rename or remove
these. The sidecar protocol is private and may change independently.

## Version policy

`0.3.x` is a pre-release line.

- patch releases should not break the JS API
- additions are allowed
- a breaking API change requires a minor bump and a changelog entry
- `1.0` freezes the public API under normal Semantic Versioning rules

## Method semantics

- Index operations are asynchronous because they cross the sidecar process boundary.
- `close`/`dispose` stop the sidecar. Later calls fail.
- Search results are typed arrays: dense returns `indices: number[]`; id-map returns
  `ids: BigUint64Array`.
- One index instance owns one sidecar process and one persisted index.
- `add`/`addWithIds` are chunked internally. If a later chunk fails, earlier chunks may already
  be committed; rebuild or clear the index before retrying a failed bulk load.
- The package owns sidecar lifecycle. Consumers own their own HTTP/gRPC/MCP/server layers.

## Platform claims

Supported binaries:

```text
linux-x64
win32-x64
darwin-arm64
```

Explicitly unsupported: Linux arm64, Windows arm64, macOS x64, Linux musl.
