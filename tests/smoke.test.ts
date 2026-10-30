import { createRequire } from 'node:module';

import { expect, test } from 'bun:test';

import { TurboQuantIndex } from '../index.js';

const require = createRequire(import.meta.url);

test('adds vectors and returns the closest slot', async () => {
  const index = new TurboQuantIndex(8, 4);
  const vectors = new Float32Array([
    1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
  ]);

  await index.add(vectors);

  const result = await index.search(new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]), 1);

  expect(index.length).toBe(3);
  expect(result.nq).toBe(1);
  expect(result.k).toBe(1);
  expect(result.indices[0]).toBe(0);
  expect(result.scores).toHaveLength(1);
});

test('round-trips through toBytes and fromBytes', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]));

  const restored = TurboQuantIndex.fromBytes(index.toBytes());

  expect(restored.length).toBe(1);
});

test('commonjs loader exposes the class', () => {
  expect(typeof require('../index.cjs').TurboQuantIndex).toBe('function');
});
