# Versioned checkpoints without a new API

`checkpoint(path, false)` is a fast snapshot primitive: it writes a unique temp file, renames
it into place, and skips fsync. That is not power-loss safe on its own. The public API is
enough to build a crash-safe layer without adding a plugin system or a new native method.

The rule: never point a durable manifest at a snapshot until the snapshot file and its
directory entry are durable, and never delete the previous snapshot until the new manifest is
durable.

```ts
import { open, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

async function fsyncFile(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncDir(path: string): Promise<void> {
  // Windows cannot fsync a directory. Treat this as best-effort there.
  try {
    const handle = await open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Ignore unsupported directory fsync.
  }
}

async function writeManifest(path: string, manifest: unknown): Promise<void> {
  const tmp = `${path}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(manifest));
  await fsyncFile(tmp);
  await rename(tmp, path);
  await fsyncDir(dirname(path));
}

async function saveVersioned(
  index: { checkpoint: (path: string, durable?: boolean) => Promise<void> },
  basePath: string,
  generation: number,
): Promise<void> {
  const versionPath = `${basePath}.${generation}.tv`;

  // Fast: write a complete snapshot to a path no one else is using.
  await index.checkpoint(versionPath, false);

  // Harden only this version, then publish it.
  await fsyncFile(versionPath);
  await fsyncDir(dirname(versionPath));
  await writeManifest(`${basePath}.json`, { generation, versionPath });

  // Safe now: the manifest is durable, so older versions are no longer needed.
  for (let old = generation - 1; old >= 0; old--) {
    await rm(`${basePath}.${old}.tv`, { force: true });
  }
}
```

On startup:

1. Read `${basePath}.json`.
2. Try `TurboQuantIndex.load(manifest.versionPath)`.
3. If it fails, fall back to the previous generation.
4. Delete orphaned version files that are not referenced by the manifest.

Crash points:

- before `fsyncFile`: the manifest still points at the old version; the new version may be
  incomplete and is garbage-collected later.
- between file fsync and manifest rename: the old manifest is still authoritative.
- after manifest rename but before directory fsync: the old or new manifest may appear after a
  power loss; both point at a complete version.
- after manifest fsync: the new version is authoritative; cleanup is safe.

`durable=true` does the same file and directory fsync inside `checkpoint`, but with a single
destination path. Use versioned paths when you need a fast return and a guaranteed previous
version.

On Windows, directory fsync is unavailable. Keep at least one previous version and validate
the manifest target on startup, so a rename that does not survive a power loss falls back
instead of leaving no loadable file.
