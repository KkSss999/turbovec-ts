# Security Policy

## Supported versions

`0.1.x` is a pre-release line. Security fixes target the latest published `0.1.x` version.
Older versions may not receive fixes.

## Reporting a vulnerability

Use GitHub private vulnerability reporting:

```text
https://github.com/KkSss999/turbovec-ts/security/advisories/new
```

Do not open a public issue for a suspected vulnerability. Include:

- affected version and platform
- Node.js/Electron/Bun version
- a minimal reproducer
- expected and actual behavior
- impact and any known workaround

Do not include npm tokens, credentials, private datasets, or production index files.

## Scope

Relevant areas include the native addon, input validation at the JS/native boundary, file
loading and persistence, resource accounting, and the packaged Electron example.

The Rust core lives in the sibling `turbovec` project. If the issue is in the core format or
search implementation, report it upstream as well.

## Response

This is a small pre-1.0 project. Reports are handled on a best-effort basis; there is no
guaranteed response or disclosure deadline yet.
