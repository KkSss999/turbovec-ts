import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IdMapIndex, TurboQuantIndex } from '../index.js';

const vectors = new Float32Array([
  1, 0, 0, 0, 0, 0, 0, 0,
  0, 1, 0, 0, 0, 0, 0, 0,
  0, 0, 1, 0, 0, 0, 0, 0,
]);
const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);

test('dense add chunks larger batches', async () => {
  const previous = process.env.TURBOVEC_ADD_CHUNK_BYTES;
  process.env.TURBOVEC_ADD_CHUNK_BYTES = '65536';
  try {
    const index = new TurboQuantIndex(8, 4);
    const rows = 20_000;
    const data = new Float32Array(rows * 8);
    for (let row = 0; row < rows; row += 1) data[row * 8] = 1;
    await index.add(data);
    expect((await index.stats()).len).toBe(rows);
    await index.close();
  } finally {
    if (previous === undefined) delete process.env.TURBOVEC_ADD_CHUNK_BYTES;
    else process.env.TURBOVEC_ADD_CHUNK_BYTES = previous;
  }
});

test('dense sidecar add, search, mask, stats, close', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(vectors);
  const result = await index.search(query, 2);
  expect(result.indices).toEqual([0, 1]);
  expect(result.nq).toBe(1);
  expect(result.k).toBe(2);

  const masked = await index.search(query, 3, new Uint8Array([0, 1, 0]));
  expect(masked.indices).toEqual([1]);

  const stats = await index.stats();
  expect(stats.kind).toBe('dense');
  expect(stats.len).toBe(3);
  expect(stats.serialized_bytes).toBeGreaterThan(0);
  await index.close();
  await index.close();
});

test('id map sidecar ids, allowlist, remove, iter and snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tv-b1-'));
  const path = join(dir, 'index.tvim');
  try {
    const index = new IdMapIndex(8, 4);
    await index.addWithIds(vectors, new BigUint64Array([10n, 20n, 30n]));
    const result = await index.search(query, 2);
    expect(Array.from(result.ids)).toEqual([10n, 20n]);

    const filtered = await index.search(query, 2, new BigUint64Array([10n, 30n]));
    expect(Array.from(filtered.ids)).toEqual([10n, 30n]);
    expect(await index.contains(10n)).toBe(true);
    expect(await index.remove(20n)).toBe(true);
    expect(await index.contains(20n)).toBe(false);
    expect(Array.from(await index.iterIds())).toEqual([10n, 30n]);

    await index.checkpoint(path);
    await index.close();

    const loaded = await IdMapIndex.load(path);
    expect(Array.from(await loaded.iterIds())).toEqual([10n, 30n]);
    await loaded.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dense snapshot loads and CJS entry exports classes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tv-b1-'));
  const path = join(dir, 'index.tv');
  try {
    const index = new TurboQuantIndex(8, 4);
    await index.add(vectors);
    await index.checkpoint(path);
    await index.close();

    const loaded = await TurboQuantIndex.load(path);
    expect(loaded.dim).toBe(8);
    expect((await loaded.search(query, 1)).indices).toEqual([0]);
    await loaded.close();

    const cjs = require('../index.cjs');
    expect(typeof cjs.TurboQuantIndex).toBe('function');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
