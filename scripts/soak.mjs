import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { TurboQuantIndex } from "../index.js";

const seconds = Number(process.env.TURBOVEC_SOAK_SECONDS ?? 30);
const dim = Number(process.env.TURBOVEC_SOAK_DIM ?? 128);
const rows = Number(process.env.TURBOVEC_SOAK_ROWS ?? 4096);
const batchSize = Number(process.env.TURBOVEC_SOAK_CONCURRENCY ?? 32);

function sidecarRssMb(pid) {
  if (process.platform === "linux") {
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const match = /VmRSS:\s+(\d+)\s+kB/.exec(status);
      return match ? Number(match[1]) / 1024 : 0;
    } catch {
      return 0;
    }
  }
  if (process.platform === "darwin") {
    try {
      return (
        Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" })) / 1024
      );
    } catch {
      return 0;
    }
  }
  if (process.platform === "win32") {
    try {
      const output = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).WorkingSet64`],
        { encoding: "utf8" },
      ).trim();
      return Number(output) / 1024 / 1024;
    } catch {
      return 0;
    }
  }
  return 0;
}

function row(index) {
  const values = new Float32Array(dim);
  values[index % dim] = 1;
  return values;
}

const data = new Float32Array(rows * dim);
for (let i = 0; i < rows; i += 1) data[i * dim + (i % dim)] = 1;
const query = row(0);
const index = new TurboQuantIndex(dim, 4);
await index.add(data);
const sidecarRssStart = sidecarRssMb(index.client.child.pid);
const start = performance.now();
const deadline = start + seconds * 1000;
let ops = 0;
let added = 0;
let batches = 0;

while (performance.now() < deadline) {
  const work = [];
  for (let i = 0; i < batchSize; i += 1) {
    if (i === 0 && batches % 8 === 0) {
      work.push(index.add(row(rows + added)));
      added += 1;
    } else if (i % 4 === 0) {
      work.push(index.stats());
    } else {
      work.push(index.search(query, 1));
    }
  }
  const results = await Promise.all(work);
  for (const result of results) {
    if (result && "indices" in result) {
      if (result.indices.length !== 1) throw new Error("unexpected search result length");
      if (result.indices[0] < 0 || result.indices[0] >= rows + added) {
        throw new Error(`search index out of range: ${result.indices[0]}`);
      }
    }
  }
  ops += work.length;
  batches += 1;
}

const elapsed = (performance.now() - start) / 1000;
const stats = await index.stats();
const sidecarRssEnd = sidecarRssMb(index.client.child.pid);
const nodeRssMb = process.memoryUsage().rss / 1024 / 1024;
await index.close();

console.log(
  JSON.stringify(
    {
      seconds: elapsed,
      ops,
      batches,
      ops_per_sec: ops / elapsed,
      len: stats.len,
      added,
      node_rss_mb: nodeRssMb,
      sidecar_rss_start_mb: sidecarRssStart,
      sidecar_rss_end_mb: sidecarRssEnd,
    },
    null,
    2,
  ),
);
if (stats.len !== rows + added) throw new Error("length drift after soak");
