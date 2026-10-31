import { readFile, writeFile } from 'node:fs/promises';

import { expect, test } from 'bun:test';

import { IdMapIndex, TurboQuantIndex } from '../index.js';
import { TurbovecError } from '../errors.js';

const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);
const twoVectors = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);

async function capture(fn: () => unknown): Promise<Error | undefined> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function expectError(error: Error | undefined, code?: string): void {
  expect(error).toBeInstanceOf(TurbovecError);
  if (code && error instanceof TurbovecError) expect(error.code).toBe(code);
}

test('rejects invalid dimensions and bit widths', async () => {
  expectError(await capture(() => new TurboQuantIndex(7, 4)), 'ERR_TURBOVEC_NATIVE');
  expectError(await capture(() => new TurboQuantIndex(0, 4)), 'ERR_TURBOVEC_NATIVE');
  expectError(await capture(() => new TurboQuantIndex(8, 1)), 'ERR_TURBOVEC_NATIVE');
  expectError(await capture(() => new TurboQuantIndex(8, 5)), 'ERR_TURBOVEC_NATIVE');
});

test('supports 2, 3, and 4 bit indexes', async () => {
  for (const bitWidth of [2, 3, 4]) {
    const index = new TurboQuantIndex(8, bitWidth);
    await index.add(query);
    const result = await index.search(query, 1);
    expect(index.length).toBe(1);
    expect(index.bitWidth).toBe(bitWidth);
    expect(result.indices[0]).toBe(0);
    index.dispose();
  }
});

test('empty and k=0 searches return an empty result, k is clamped', async () => {
  const empty = new TurboQuantIndex(8, 4);
  const emptyResult = await empty.search(query, 1);
  expect(emptyResult.nq).toBe(1);
  expect(emptyResult.k).toBe(0);
  expect(emptyResult.indices).toEqual([]);

  const index = new TurboQuantIndex(8, 4);
  await index.add(twoVectors);
  const zero = await index.search(query, 0);
  expect(zero.k).toBe(0);
  expect(zero.indices).toEqual([]);

  const tooMany = await index.search(query, 10);
  expect(tooMany.k).toBe(2);
  expect(tooMany.indices).toEqual([0, 1]);
});

test('rejects malformed vector, query, and mask lengths', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(twoVectors);

  expectError(
    await capture(() => index.add(new Float32Array([1, 0, 0]))),
    'ERR_TURBOVEC_INVALID_INPUT',
  );
  expectError(await capture(() => index.search(new Float32Array([1]), 1)), 'ERR_TURBOVEC_NATIVE');
  expectError(
    await capture(() => index.search(query, 1, new Uint8Array([1]))),
    'ERR_TURBOVEC_NATIVE',
  );
});

test('rejects malformed id batches', async () => {
  const index = new IdMapIndex(8, 4);

  expectError(
    await capture(() => index.addWithIds(twoVectors, new BigUint64Array([1n]))),
    'ERR_TURBOVEC_INVALID_INPUT',
  );
  expectError(
    await capture(() => index.addWithIds(twoVectors, new BigUint64Array([1n, 1n]))),
    'ERR_TURBOVEC_NATIVE',
  );
  expectError(
    await capture(async () => {
      await index.addWithIds(twoVectors, new BigUint64Array([1n, 2n]));
      return index.search(query, 1, new BigUint64Array([]));
    }),
    'ERR_TURBOVEC_NATIVE',
  );
  expectError(
    await capture(async () => {
      await index.addWithIds(twoVectors, new BigUint64Array([1n, 2n]));
      return index.search(query, 1, new BigUint64Array([99n]));
    }),
    'ERR_TURBOVEC_NATIVE',
  );
  expect(await index.remove(99n)).toBe(false);
  expectError(await capture(() => index.remove(-1n)), 'ERR_TURBOVEC_INVALID_INPUT');
  expectError(await capture(() => index.contains(2n ** 64n)), 'ERR_TURBOVEC_INVALID_INPUT');
});

test('rejects empty calibration samples', async () => {
  const index = new TurboQuantIndex(8, 4);
  expectError(await capture(() => index.calibrate(new Float32Array([]))), 'ERR_TURBOVEC_NATIVE');
});

test('rejects empty and junk serialized data', async () => {
  expectError(
    await capture(() => TurboQuantIndex.fromBytes(Buffer.alloc(0))),
    'ERR_TURBOVEC_NATIVE',
  );
  expectError(
    await capture(() => TurboQuantIndex.fromBytes(Buffer.from('not a turbovec index'))),
    'ERR_TURBOVEC_NATIVE',
  );
});

test('rejects truncated and corrupt files', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/index.tv`;
  const corruptPath = `${dir.trim()}/corrupt.tv`;

  try {
    const index = new TurboQuantIndex(8, 4);
    await index.add(twoVectors);
    await index.write(path);

    const bytes = await readFile(path);
    await writeFile(corruptPath, bytes.subarray(0, Math.floor(bytes.length / 2)));

    expectError(await capture(() => TurboQuantIndex.load(corruptPath)), 'ERR_TURBOVEC_IO');
    expectError(
      await capture(() => TurboQuantIndex.load(`${dir.trim()}/missing.tv`)),
      'ERR_TURBOVEC_IO',
    );
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`;
  }
});

test('dispose is idempotent and rejects later operations', async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(twoVectors);
  index.dispose();
  index.dispose();

  expect(index.isDisposed).toBe(true);
  expect(index.estimatedBytes).toBe(0);
  expectError(await capture(() => index.search(query, 1)), 'ERR_TURBOVEC_DISPOSED');
  expectError(await capture(() => index.add(twoVectors)), 'ERR_TURBOVEC_DISPOSED');
});
