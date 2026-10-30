import { createRequire } from 'node:module';

import { expect, test } from 'bun:test';

import { IdMapIndex, TurboQuantIndex } from '../index.js';

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
