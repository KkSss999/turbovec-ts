import { chmod, readdir, utimes } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { expect, test } from 'bun:test';

import { IdMapIndex, TurboQuantIndex } from '../index.js';
import { TurbovecError, toTurbovecError } from '../errors.js';

const require = createRequire(import.meta.url);

const vectors = new Float32Array([
  1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
]);

const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);

test('adds vectors and returns the closest slot', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(vectors);

  const result = await index.search(query, 1);

  expect(index.length).toBe(3);
  expect(result.nq).toBe(1);
  expect(result.k).toBe(1);
  expect(result.indices[0]).toBe(0);
  expect(result.scores).toHaveLength(1);
});

test('restricts search with a byte mask', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(vectors);

  const result = await index.search(query, 3, new Uint8Array([0, 1, 0]));

  expect(result.k).toBe(1);
  expect(result.indices).toEqual([1]);
});

test('round-trips through toBytes and fromBytes', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(vectors);

  const restored = TurboQuantIndex.fromBytes(index.toBytes());

  expect(restored.length).toBe(3);
});

test('maps external ids and supports allowlists', async () => {
  const index = new IdMapIndex(8, 4);
  await index.addWithIds(vectors, new BigUint64Array([10n, 20n, 30n]));

  const all = await index.search(query, 2);
  expect(all.ids[0]).toBe(10n);

  const filtered = await index.search(query, 2, new BigUint64Array([10n, 30n]));
  expect(Array.from(filtered.ids)).toEqual([10n, 30n]);

  expect(await index.remove(20n)).toBe(true);
  expect(index.contains(20n)).toBe(false);
  expect(index.length).toBe(2);
});

test('preserves ids above 2^53', async () => {
  const index = new IdMapIndex(8, 4);
  const id = 9007199254740993n;
  await index.addWithIds(vectors, new BigUint64Array([id, 2n, 3n]));

  const result = await index.search(query, 1);
  expect(result.ids[0]).toBe(id);
});

test('commonjs loader exposes the classes', () => {
  expect(typeof require('../index.cjs').TurboQuantIndex).toBe('function');
  expect(typeof require('../index.cjs').IdMapIndex).toBe('function');
});

test('writes, loads, and syncs through files', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/index.tv`;
  try {
    const index = new TurboQuantIndex(8, 4);
    await index.add(vectors);
    await index.write(path);

    const loaded = await TurboQuantIndex.load(path);
    expect(loaded.length).toBe(3);

    await loaded.add(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0]));
    await loaded.sync(path);

    const restored = await TurboQuantIndex.load(path);
    expect(restored.length).toBe(4);
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`;
  }
});

test('calibrates and prepares an index', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(vectors);

  expect(index.calibrationState).toBe('uncalibrated');
  await index.calibrate(vectors);
  expect(index.calibrationState).toBe('calibrated');
  await index.prepare();
});

test('round-trips an id map through a file', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/index.tvim`;
  try {
    const index = new IdMapIndex(8, 4);
    await index.addWithIds(vectors, new BigUint64Array([10n, 20n, 30n]));
    await index.write(path);

    const loaded = await IdMapIndex.load(path);
    expect(loaded.length).toBe(3);
    expect(loaded.contains(20n)).toBe(true);
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`;
  }
});

test('dispose releases the index and rejects later calls', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(vectors);
  index.dispose();

  let error: Error | undefined;
  try {
    await index.search(query, 1);
  } catch (cause) {
    error = toTurbovecError(cause);
  }

  expect(error).toBeInstanceOf(TurbovecError);
  if (error instanceof TurbovecError) {
    expect(error.code).toBe('ERR_TURBOVEC_DISPOSED');
  }
});

test('maps native load failures to TurbovecError', async () => {
  let error: Error | undefined;
  try {
    await TurboQuantIndex.load('/definitely/not/a/turbovec/index.tv');
  } catch (cause) {
    error = cause instanceof Error ? cause : new Error(String(cause));
  }

  expect(error).toBeInstanceOf(TurbovecError);
  if (error instanceof TurbovecError) {
    expect(error.code).toBe('ERR_TURBOVEC_IO');
  }
});

test('maps prefixed errors for non-native callers', () => {
  const error = toTurbovecError(new Error('ERR_TURBOVEC_IO: disk failed'));

  expect(error).toBeInstanceOf(TurbovecError);
  if (error instanceof TurbovecError) {
    expect(error.code).toBe('ERR_TURBOVEC_IO');
    expect(error.message).toBe('disk failed');
  }
});

test('swapRemove moves the last slot into the removed position', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(vectors);

  const moved = await index.swapRemove(0);

  expect(moved).toBe(2);
  expect(index.length).toBe(2);

  const result = await index.search(new Float32Array([0, 0, 1, 0, 0, 0, 0, 0]), 1);
  expect(result.indices[0]).toBe(0);
});

test('swapRemove rejects an out-of-range slot', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(vectors);

  let error: Error | undefined;
  try {
    await index.swapRemove(99);
  } catch (cause) {
    error = cause instanceof Error ? cause : new Error(String(cause));
  }

  expect(error).toBeInstanceOf(TurbovecError);
  if (error instanceof TurbovecError) {
    expect(error.code).toBe('ERR_TURBOVEC_INVALID_INPUT');
  }
});

test('iterIds returns the external ids in slot order', async () => {
  const index = new IdMapIndex(8, 4);
  await index.addWithIds(vectors, new BigUint64Array([10n, 20n, 30n]));

  expect(Array.from(index.iterIds())).toEqual([10n, 20n, 30n]);
});

test('reports estimated memory and disposed state', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(vectors);

  expect(index.isDisposed).toBe(false);
  expect(index.estimatedBytes).toBeGreaterThan(0);

  index.dispose();

  expect(index.isDisposed).toBe(true);
  expect(index.estimatedBytes).toBe(0);
});

test('clears an index without disposing it', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(vectors);
  await index.calibrate(vectors);

  index.clear();

  expect(index.length).toBe(0);
  expect(index.isDisposed).toBe(false);
  expect(index.calibrationState).toBe('uncalibrated');
  expect(index.estimatedBytes).toBeGreaterThan(0);
});

test('reports the exact serialized length', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(vectors);

  expect(index.serializedLength).toBe(index.toBytes().length);
});

test('reports the exact id map serialized length', async () => {
  const index = new IdMapIndex(8, 4);
  await index.addWithIds(vectors, new BigUint64Array([10n, 20n, 30n]));

  expect(index.serializedLength).toBe(index.toBytes().length);
});

test('sync and search can run with the same index', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/index.tv`;
  try {
    const index = new TurboQuantIndex(8, 4);
    await index.add(vectors);

    const [search] = await Promise.all([index.search(query, 1), index.sync(path)]);

    expect(search.indices[0]).toBe(0);
    expect((await TurboQuantIndex.load(path)).length).toBe(3);
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`;
  }
});

test('concurrent loads stay independent', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/index.tv`;
  try {
    const index = new TurboQuantIndex(8, 4);
    await index.add(vectors);
    await index.write(path);

    const [first, second] = await Promise.all([
      TurboQuantIndex.load(path),
      TurboQuantIndex.load(path),
    ]);

    expect(first.length).toBe(3);
    expect(second.length).toBe(3);
    expect(first).not.toBe(second);
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`;
  }
});

test('dispose racing a search does not deadlock', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(vectors);

  await Promise.allSettled([index.search(query, 1), Promise.resolve(index.dispose())]);

  expect(index.isDisposed).toBe(true);
});

test('clear racing an add does not deadlock', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(vectors);

  await Promise.all([
    index.add(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0])),
    Promise.resolve(index.clear()),
  ]);

  expect(index.isDisposed).toBe(false);
  expect(index.length).toBeGreaterThanOrEqual(0);
});

test('checkpoint writes a loadable full snapshot', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/checkpoint.tv`;
  try {
    const index = new TurboQuantIndex(8, 4);
    await index.add(vectors);
    await index.checkpoint(path);

    expect(index.lastWarning).toBeNull();

    const loaded = await TurboQuantIndex.load(path);
    expect(loaded.length).toBe(3);
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`;
  }
});

test('checkpoint works for an id map and concurrent search', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/checkpoint.tvim`;
  try {
    const index = new IdMapIndex(8, 4);
    await index.addWithIds(vectors, new BigUint64Array([10n, 20n, 30n]));

    const [result] = await Promise.all([index.search(query, 1), index.checkpoint(path)]);

    expect(result.ids[0]).toBe(10n);
    const loaded = await IdMapIndex.load(path);
    expect(loaded.length).toBe(3);
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`;
  }
});

test('checkpoint reports io errors', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(vectors);

  let error: Error | undefined;
  try {
    await index.checkpoint('/definitely/not/a/turbovec/dir/index.tv');
  } catch (cause) {
    error = cause instanceof Error ? cause : new Error(String(cause));
  }

  expect(error).toBeInstanceOf(TurbovecError);
  if (error instanceof TurbovecError) {
    expect(error.code).toBe('ERR_TURBOVEC_IO');
  }
});

test('checkpoint removes stale temp siblings and keeps fresh ones', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/index.tv`;
  const stale = `${path}.tmp.123.0`;
  const fresh = `${path}.tmp.123.1`;
  try {
    await Bun.write(stale, 'stale');
    await Bun.write(fresh, 'fresh');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(stale, old, old);

    const index = new TurboQuantIndex(8, 4);
    await index.add(vectors);
    await index.checkpoint(path);

    expect(await Bun.file(stale).exists()).toBe(false);
    expect(await Bun.file(fresh).exists()).toBe(true);
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`;
  }
});

test('concurrent checkpoints to one path leave a loadable file', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/index.tv`;
  try {
    const three = new TurboQuantIndex(8, 4);
    await three.add(vectors);

    const four = new TurboQuantIndex(8, 4);
    await four.add(
      new Float32Array([
        1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
        0,
      ]),
    );

    await Promise.all([
      three.checkpoint(path),
      four.checkpoint(path),
      three.checkpoint(path),
      four.checkpoint(path),
    ]);

    const loaded = await TurboQuantIndex.load(path);
    expect([3, 4]).toContain(loaded.length);

    const entries = await readdir(dir.trim());
    expect(entries.filter((name) => name.includes('.tmp.'))).toEqual([]);
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`;
  }
});

test('checkpoint cleanup uses the one-hour boundary', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/index.tv`;
  const young = `${path}.tmp.1.0`;
  const old = `${path}.tmp.1.1`;
  try {
    await Bun.write(young, 'young');
    await Bun.write(old, 'old');

    const now = Date.now();
    await utimes(young, new Date(now - 59 * 60 * 1000), new Date(now - 59 * 60 * 1000));
    await utimes(old, new Date(now - 61 * 60 * 1000), new Date(now - 61 * 60 * 1000));

    const index = new TurboQuantIndex(8, 4);
    await index.add(vectors);
    await index.checkpoint(path);

    expect(await Bun.file(young).exists()).toBe(true);
    expect(await Bun.file(old).exists()).toBe(false);
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`;
  }
});

test('checkpoint with durable=false still writes a loadable file', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/fast.tv`;
  try {
    const index = new TurboQuantIndex(8, 4);
    await index.add(vectors);
    await index.checkpoint(path, false);

    const loaded = await TurboQuantIndex.load(path);
    expect(loaded.length).toBe(3);
    expect((await readdir(dir.trim())).filter((name) => name.includes('.tmp.'))).toEqual([]);
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`;
  }
});

test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'reports a parent directory fsync warning after commit',
  async () => {
    const dir = await Bun.$`mktemp -d`.text();
    const path = `${dir.trim()}/index.tv`;
    const index = new TurboQuantIndex(8, 4);
    await index.add(vectors);
    try {
      await chmod(dir.trim(), 0o300);
      await index.checkpoint(path);
      expect(index.lastWarning).toContain('parent directory fsync failed');

      await chmod(dir.trim(), 0o700);
      await index.checkpoint(path);
      expect(index.lastWarning).toBeNull();
    } finally {
      await chmod(dir.trim(), 0o700).catch(() => {});
      await Bun.$`rm -rf ${dir.trim()}`;
    }
  },
);
