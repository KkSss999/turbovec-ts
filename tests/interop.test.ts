import { expect, test } from 'bun:test';

import { IdMapIndex, TurboQuantIndex } from '../index.js';

const vectors = new Float32Array([
  1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
]);

const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);

const python = process.env.TURBOVEC_PYTHON ?? 'python3';

function pythonInteropAvailable(): boolean {
  try {
    return Bun.spawnSync([python, '-c', 'import turbovec']).exitCode === 0;
  } catch {
    return false;
  }
}

const cargoLock = await Bun.file(new URL('../Cargo.lock', import.meta.url)).text();
const corePackage = cargoLock
  .split('[[package]]')
  .find((block) => block.includes('name = "turbovec"'));
const coreVersion = corePackage?.match(/version = "([^"]+)"/)?.[1];

test.skipIf(!pythonInteropAvailable())('python package matches the rust core version', () => {
  if (!coreVersion) throw new Error('could not read turbovec version from Cargo.lock');
  const result = Bun.spawnSync([python, '-c', 'import turbovec; print(turbovec.__version__)']);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  expect(result.stdout.toString().trim()).toBe(coreVersion);
});

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

test.skipIf(!pythonInteropAvailable())('loads a checkpoint file in Python', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/checkpoint.tv`;
  try {
    const index = new TurboQuantIndex(8, 4);
    await index.add(vectors);
    await index.checkpoint(path);

    const script = `
import sys
from turbovec import TurboQuantIndex

index = TurboQuantIndex.load(sys.argv[1])
assert len(index) == 3
`;
    const result = Bun.spawnSync([python, '-c', script, path]);
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`;
  }
});

test.skipIf(!pythonInteropAvailable())('loads an id map checkpoint in Python', async () => {
  const dir = await Bun.$`mktemp -d`.text();
  const path = `${dir.trim()}/checkpoint.tvim`;
  try {
    const index = new IdMapIndex(8, 4);
    await index.addWithIds(vectors, new BigUint64Array([10n, 20n, 30n]));
    await index.checkpoint(path);

    const script = `
import sys
import numpy as np
from turbovec import IdMapIndex

index = IdMapIndex.load(sys.argv[1])
assert len(index) == 3
scores, ids = index.search(np.array([[1, 0, 0, 0, 0, 0, 0, 0]], dtype=np.float32), 1)
assert int(ids[0][0]) == 10
`;
    const result = Bun.spawnSync([python, '-c', script, path]);
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`;
  }
});
