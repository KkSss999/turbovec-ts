import { expect, setDefaultTimeout, test } from "bun:test";

import { IdMapIndex, TurboQuantIndex, TurbovecError, toTurbovecError } from "../index.js";

setDefaultTimeout(30_000);

test("public API exports are present", () => {
  expect(typeof TurboQuantIndex).toBe("function");
  expect(typeof IdMapIndex).toBe("function");
  expect(typeof TurbovecError).toBe("function");
  expect(typeof toTurbovecError).toBe("function");
});

test("public class surfaces are frozen for 0.3.x", () => {
  const dense = Object.getOwnPropertyNames(TurboQuantIndex.prototype).sort();
  const idmap = Object.getOwnPropertyNames(IdMapIndex.prototype).sort();
  expect(dense).toEqual(
    [
      "add",
      "calibrate",
      "checkpoint",
      "close",
      "constructor",
      "dispose",
      "prepare",
      "search",
      "stats",
      "swapRemove",
      "sync",
      "write",
    ].sort(),
  );
  expect(idmap).toEqual(
    [
      "addWithIds",
      "calibrate",
      "checkpoint",
      "close",
      "constructor",
      "contains",
      "dispose",
      "iterIds",
      "prepare",
      "remove",
      "search",
      "stats",
      "sync",
      "write",
    ].sort(),
  );
});

test("error helper maps native prefixes without swallowing other errors", () => {
  const mapped = toTurbovecError(new Error("ERR_TURBOVEC_IO: disk failed"));
  expect(mapped).toBeInstanceOf(TurbovecError);
  if (mapped instanceof TurbovecError) expect(mapped.code).toBe("ERR_TURBOVEC_IO");

  const plain = new Error("plain");
  expect(toTurbovecError(plain)).toBe(plain);
});
