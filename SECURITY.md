# Security Policy

## Supported versions

`0.3.x` is a pre-release line. Security fixes target the latest `0.3.x` version.

## Reporting a vulnerability

Use GitHub private vulnerability reporting:

```text
https://github.com/KkSss999/turbovec-ts/security/advisories/new
```

Do not open a public issue for a suspected vulnerability. Include the package version, platform,
Node/Bun/Electron version, a minimal reproducer, and impact.

Do not include credentials, private datasets, or production index files.

## Scope

Relevant areas include the sidecar binary, the JS client/sidecar protocol, input validation, file
loading/persistence, and sidecar process lifecycle. The package does not ship a network listener
or authentication layer; consumer-owned servers and IPC are outside this package's security
boundary.

The Rust core lives in the upstream `turbovec` project; report core format or kernel issues there
as well.

## Response

This is a small pre-1.0 project. Reports are handled on a best-effort basis.
