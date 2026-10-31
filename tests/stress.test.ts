import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TurboQuantIndex, TurbovecError } from "../index.js";

setDefaultTimeout(30_000);

function row(value) {
  const data = new Float32Array(8);
  data[value % 8] = 1;
  return data;
}

test("concurrent searches, stats and bulk adds stay isolated", async () => {
  const index = new TurboQuantIndex(8, 4);
  for (let i = 0; i < 64; i += 1) await index.add(row(i));

  const searches = Array.from({ length: 100 }, () => index.search(row(0), 1));
  const stats = Array.from({ length: 40 }, () => index.stats());
  const adds = Array.from({ length: 24 }, (_, i) => index.add(row(64 + i)));
  const [searchResults] = await Promise.all([
    Promise.all(searches),
    Promise.all(stats),
    Promise.all(adds),
  ]);

  for (const result of searchResults) {
    expect(result.indices.length).toBe(1);
    expect(result.indices[0]).toBeGreaterThanOrEqual(0);
    expect(result.indices[0]).toBeLessThan(88);
  }
  expect((await index.stats()).len).toBe(88);
  await index.close();
});

test("repeated search and stats cycles do not wedge the sidecar", async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.add(row(0));
  for (let i = 0; i < 250; i += 1) {
    const result = await index.search(row(0), 1);
    expect(result.indices).toEqual([0]);
    if (i % 25 === 0) expect((await index.stats()).len).toBe(1);
  }
  await index.close();
});

test("sidecar crash rejects pending work and a checkpoint can be restarted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-crash-"));
  const snapshot = join(dir, "index.tv");
  try {
    const index = new TurboQuantIndex(8, 4);
    await index.add(row(0));
    await index.checkpoint(snapshot);

    const pending = index.search(new Float32Array(100_000 * 8), 1);
    index.client.child.kill();
    await expect(pending).rejects.toBeInstanceOf(TurbovecError);
    expect(index.client.closed).toBe(true);
    await index.close();

    const restarted = await TurboQuantIndex.load(snapshot);
    expect((await restarted.search(row(0), 1)).indices).toEqual([0]);
    await restarted.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
