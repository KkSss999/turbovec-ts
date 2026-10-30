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

const python = process.env.TURBOVEC_PYTHON ?? 'python3';

function pythonInteropAvailable(): boolean {
  try {
    return Bun.spawnSync([python, '-c', 'import turbovec']).exitCode === 0;
  } catch {
    return false;
  }
}

test.skipIf(!pythonInteropAvailable())('loads a file written by Python', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/python.tv`;
  try {
    const script = `
import sys
import numpy as np
from turbovec import TurboQuantIndex

index = TurboQuantIndex(dim=8, bit_width=4)
index.add(np.array([[1, 0, 0, 0, 0, 0, 0, 0]], dtype=np.float32))
index.write(sys.argv[1])
`;
    const result = Bun.spawnSync([python, '-c', script, path]);
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());

    const loaded = await TurboQuantIndex.load(path);
    const search = await loaded.search(query, 1);
    expect(loaded.length).toBe(1);
    expect(search.indices[0]).toBe(0);
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`;
  }
});

test.skipIf(!pythonInteropAvailable())('writes a file Python can load', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/node.tv`;
  try {
    const index = new TurboQuantIndex(8, 4);
    await index.add(vectors);
    await index.write(path);

    const script = `
import sys
import numpy as np
from turbovec import TurboQuantIndex

index = TurboQuantIndex.load(sys.argv[1])
assert len(index) == 3
scores, indices = index.search(np.array([[1, 0, 0, 0, 0, 0, 0, 0]], dtype=np.float32), 1)
assert int(indices[0][0]) == 0
`;
    const result = Bun.spawnSync([python, '-c', script, path]);
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
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
