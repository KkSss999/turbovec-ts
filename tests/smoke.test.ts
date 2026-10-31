import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IdMapIndex, TurboQuantIndex, TurbovecError } from "../index.js";

setDefaultTimeout(30_000);

const rows = new Float32Array([
  1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
]);
const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);

test("packaged dense smoke: calibrate, prepare, sync, load, search", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-smoke-dense-"));
  const snapshot = join(dir, "index.tv");
  const syncPath = join(dir, "sync.tv");
  try {
    const index = new TurboQuantIndex(8, 4);
    await index.calibrate(rows);
    await index.add(rows);
    await index.prepare();
    expect((await index.search(query, 2)).indices).toEqual([0, 1]);

    await index.sync(syncPath);
    await index.checkpoint(snapshot);
    expect(Number.isInteger(await index.swapRemove(0))).toBe(true);
    await index.close();

    const loaded = await TurboQuantIndex.load(snapshot);
    expect(loaded.dim).toBe(8);
    expect((await loaded.search(query, 1)).indices.length).toBe(1);
    await loaded.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("packaged id-map smoke: allowlist, removal and snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tv-smoke-idmap-"));
  const snapshot = join(dir, "index.tvim");
  try {
    const index = new IdMapIndex(8, 4);
    await index.addWithIds(rows, new BigUint64Array([10n, 20n, 30n]));
    const filtered = await index.search(query, 3, new BigUint64Array([10n, 30n]));
    expect(Array.from(filtered.ids)).toEqual([10n, 30n]);
    expect(await index.remove(20n)).toBe(true);
    expect(await index.contains(20n)).toBe(false);
    await index.checkpoint(snapshot);
    await index.close();

    const loaded = await IdMapIndex.load(snapshot);
    expect(Array.from(await loaded.iterIds())).toEqual([10n, 30n]);
    await loaded.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("disposed and invalid inputs use package error codes", async () => {
  const index = new TurboQuantIndex(8, 4);
  await index.close();
  await expect(index.stats()).rejects.toBeInstanceOf(TurbovecError);
  await expect(index.add(rows)).rejects.toMatchObject({ code: "ERR_TURBOVEC_DISPOSED" });

  const invalid = new TurboQuantIndex(8, 4);
  await expect(invalid.add(new Float32Array(7))).rejects.toMatchObject({
    code: "ERR_TURBOVEC_INVALID_INPUT",
  });
  await invalid.close();
});
