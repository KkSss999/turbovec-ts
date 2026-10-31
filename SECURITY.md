# Security Policy

## Supported versions

`0.2.x` is a pre-release line. Security fixes target the latest `0.2.x` version.

## Reporting a vulnerability

Use GitHub private vulnerability reporting:

```text
https://github.com/KkSss999/turbovec-ts/security/advisories/new
```

Do not open a public issue for a suspected vulnerability. Include:

- affected version and target
- a minimal reproducer
- expected and actual behavior
- impact and any known workaround

Do not include credentials, private datasets, or production index files.

## Scope

Relevant areas include input validation, file loading and persistence, index lifecycle, and
resource accounting. The crate does not ship a network listener or authentication layer; those
are consumer responsibilities. The Rust core lives in the sibling `turbovec` project; report core
format or kernel issues upstream as well.

## Response

This is a small pre-1.0 project. Reports are handled on a best-effort basis.
