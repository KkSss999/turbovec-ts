# API stability

## Public surface

The public API is:

- `TurboQuantIndex` and `IdMapIndex` from the package root
- `TurbovecError` and `toTurbovecError` from `turbovec-ts/errors`
- the types in `index.d.ts` and `errors.d.ts`
- documented error codes
- the `.tv` / `.tvim` on-disk formats produced by the linked core

Generated `native.*` files, internal Rust modules, temp-file naming, and the versioned-checkpoint
recipe in `docs/versioned-checkpoint.md` are implementation details, not API.

## Version policy

`0.1.x` is the first prepared line.

- Patch releases (`0.1.1` → `0.1.2`) must not break the public API or documented behavior.
- Additions are allowed in patch releases when they are backwards compatible.
- A breaking change requires a minor bump (`0.1` → `0.2`) and a changelog entry.
- `1.0.0` freezes the public API under normal Semantic Versioning rules.

Deprecations should be marked in `index.d.ts` and the changelog, and kept for at least one minor
release when practical.

## Error codes

The `ERR_TURBOVEC_*` codes are part of the public contract. New codes may be added. A code
should not change meaning in a patch release.

## On-disk format

The binding uses the core `turbovec` v7/v8 reader and writer. Do not change the format in this
package. Format changes belong upstream and require an explicit compatibility and migration
note.

The optional Python interop gate checks the Python package version against `Cargo.lock`; run it
whenever the format boundary changes.

## Platform claims

Compilation is not support. A platform is supported only after the runtime and packaged smoke
matrix passes on that target. Current status is tracked in `docs/durability.md`.

## Adding API

Before adding a public method or option:

1. Check whether an existing primitive can compose it.
2. Add JSDoc and a test.
3. Add a changelog entry.
4. Decide whether it is part of the stable surface or an explicitly unstable helper.
