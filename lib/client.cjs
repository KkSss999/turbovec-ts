'use strict';

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const { TurbovecError, toTurbovecError } = require('./errors.cjs');

const DEFAULT_ADD_CHUNK_BYTES = 16 * 1024 * 1024;

const PLATFORM_BIN = new Set(['linux-x64', 'linux-x64-musl', 'win32-x64', 'darwin-arm64']);

function isMusl() {
  if (process.platform !== 'linux') return false;
  try {
    if (existsSync('/etc/alpine-release')) return true;
    const report = process.report?.getReport?.();
    if (report?.header?.glibcVersionRuntime) return false;
    if (Array.isArray(report?.sharedObjects)) {
      return report.sharedObjects.some((entry) => entry.includes('ld-musl-'));
    }
  } catch {
    // Fall through to the glibc build.
  }
  return false;
}

function sidecarPath() {
  if (process.env.TURBOVEC_SIDECAR) return process.env.TURBOVEC_SIDECAR;
  const platform = `${process.platform}-${process.arch}`;
  const folder = platform === 'linux-x64' && isMusl() ? 'linux-x64-musl' : platform;
  if (!PLATFORM_BIN.has(folder)) {
    throw new TurbovecError(
      'ERR_TURBOVEC_UNSUPPORTED',
      `turbovec-ts does not ship a sidecar for ${platform}${isMusl() ? ' (musl)' : ''}`,
    );
  }
  const binary = process.platform === 'win32' ? 'turbovecd.exe' : 'turbovecd';
  const path = join(__dirname, '..', 'bin', folder, binary);
  if (!existsSync(path)) {
    throw new TurbovecError('ERR_TURBOVEC_IO', `turbovec sidecar is missing: ${path}`);
  }
  return path;
}

class FrameReader {
  constructor(stream, onFrame) {
    this.buffer = Buffer.alloc(0);
    stream.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain(onFrame);
    });
  }

  drain(onFrame) {
    while (this.buffer.length >= 4) {
      const headerLength = this.buffer.readUInt32LE(0);
      if (this.buffer.length < 4 + headerLength) return;
      let header;
      try {
        header = JSON.parse(this.buffer.subarray(4, 4 + headerLength).toString('utf8'));
      } catch (error) {
        throw toTurbovecError(error);
      }
      const payloadLength = Number(header.payload ?? 0);
      if (this.buffer.length < 4 + headerLength + payloadLength) return;
      const payload = this.buffer.subarray(4 + headerLength, 4 + headerLength + payloadLength);
      this.buffer = this.buffer.subarray(4 + headerLength + payloadLength);
      onFrame(header, payload);
    }
  }
}

class SidecarClient {
  constructor(options = {}) {
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.stderr = '';
    this.readyValue = undefined;

    const bin = sidecarPath();
    const args = [];
    if (options.load) {
      args.push('--load', options.load, '--kind', options.kind ?? 'dense');
    } else {
      args.push('--dim', String(options.dim), '--bits', String(options.bits ?? 4));
      args.push('--kind', options.kind ?? 'dense');
    }

    this.child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    new FrameReader(this.child.stdout, (header, payload) => {
      if (header.ready) {
        this.readyValue = header;
        this.resolveReady(header);
        return;
      }
      const id = Number(header.id ?? 0);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (header.ok) {
        pending.resolve({ header, payload });
      } else {
        pending.reject(
          new TurbovecError(header.code ?? 'ERR_TURBOVEC_NATIVE', header.message ?? 'sidecar error'),
        );
      }
    });

    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString();
      if (this.stderr.length > 16_384) this.stderr = this.stderr.slice(-16_384);
    });
    this.child.on('error', (error) => {
      this.rejectReady(toTurbovecError(error));
      this.failPending(error);
    });
    this.child.on('exit', (code, signal) => {
      this.closed = true;
      const error = new TurbovecError(
        'ERR_TURBOVEC_IO',
        `turbovec sidecar exited (code=${code}, signal=${signal})${this.stderr ? `: ${this.stderr.trim()}` : ''}`,
      );
      this.rejectReady(error);
      this.failPending(error);
    });
  }

  failPending(error) {
    for (const pending of this.pending.values()) pending.reject(toTurbovecError(error));
    this.pending.clear();
  }

  async request(op, header = {}, payload = Buffer.alloc(0)) {
    await this.ready;
    if (this.closed) throw new TurbovecError('ERR_TURBOVEC_DISPOSED', 'service is closed');
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const frame = Buffer.from(
        JSON.stringify({ ...header, id, op, payload: payload.length }),
        'utf8',
      );
      const length = Buffer.alloc(4);
      length.writeUInt32LE(frame.length, 0);
      try {
        this.child.stdin.write(length);
        this.child.stdin.write(frame);
        if (payload.length > 0) this.child.stdin.write(payload);
      } catch (error) {
        this.pending.delete(id);
        reject(toTurbovecError(error));
      }
    });
  }

  async close() {
    if (this.closed) return;
    try {
      await this.request('shutdown');
    } catch {
      // The process may have already exited.
    }
    await new Promise((resolve) => {
      if (this.closed) return resolve();
      const timer = setTimeout(() => {
        this.child.kill();
        resolve();
      }, 2_000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function addChunkBytes() {
  const value = Number(process.env.TURBOVEC_ADD_CHUNK_BYTES ?? DEFAULT_ADD_CHUNK_BYTES);
  return Number.isFinite(value) && value >= 4096 ? Math.floor(value) : DEFAULT_ADD_CHUNK_BYTES;
}

function addChunkRows(dim) {
  return Math.max(1, Math.floor(addChunkBytes() / (dim * 4)));
}

function floatPayload(values) {
  if (!(values instanceof Float32Array)) {
    throw new TurbovecError('ERR_TURBOVEC_INVALID_INPUT', 'expected a Float32Array');
  }
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

function u64Payload(values) {
  if (!(values instanceof BigUint64Array)) {
    throw new TurbovecError('ERR_TURBOVEC_INVALID_INPUT', 'expected a BigUint64Array');
  }
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

class TurboQuantIndex {
  constructor(dim, bits = 4) {
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new TurbovecError('ERR_TURBOVEC_INVALID_INPUT', 'dim must be a positive integer');
    }
    this.dim = dim;
    this.bitWidth = bits;
    this.client = new SidecarClient({ dim, bits, kind: 'dense' });
  }

  async add(vectors) {
    const rows = vectors.length / this.dim;
    if (!Number.isInteger(rows)) {
      throw new TurbovecError('ERR_TURBOVEC_INVALID_INPUT', 'vectors length must be a multiple of dim');
    }
    const chunkRows = addChunkRows(this.dim);
    for (let start = 0; start < rows; start += chunkRows) {
      const end = Math.min(rows, start + chunkRows);
      const slice = vectors.subarray(start * this.dim, end * this.dim);
      await this.client.request('add', { rows: end - start }, floatPayload(slice));
    }
  }

  async swapRemove(slot) {
    const { header } = await this.client.request('swap_remove', { slot });
    return header.moved;
  }

  async search(queries, k, mask) {
    const nq = queries.length / this.dim;
    if (!Number.isInteger(nq)) {
      throw new TurbovecError('ERR_TURBOVEC_INVALID_INPUT', 'queries length must be a multiple of dim');
    }
    const queryPayload = floatPayload(queries);
    const payload = mask ? Buffer.concat([queryPayload, Buffer.from(mask)]) : queryPayload;
    const { header, payload: result } = await this.client.request('search', { nq, k }, payload);
    const scores = new Float32Array(header.nq * header.k);
    for (let i = 0; i < scores.length; i += 1) scores[i] = result.readFloatLE(i * 4);
    const indices = [];
    let offset = header.nq * header.k * 4;
    for (let i = 0; i < header.nq * header.k; i += 1) {
      indices.push(result.readUInt32LE(offset));
      offset += 4;
    }
    return { scores, indices, nq: header.nq, k: header.k };
  }

  async checkpoint(path, durable = true) {
    await this.client.request('checkpoint', { path, durable });
  }

  async write(path, durable = true) {
    await this.checkpoint(path, durable);
  }

  async sync(path) {
    await this.client.request('sync', { path });
  }

  async calibrate(sample) {
    await this.client.request('calibrate', {}, floatPayload(sample));
  }

  async prepare() {
    await this.client.request('prepare');
  }

  async stats() {
    const { header } = await this.client.request('stats');
    return {
      kind: header.kind,
      dim: header.dim,
      bits: header.bits,
      len: header.len,
      serialized_bytes: header.serialized_bytes,
      estimated_bytes: header.estimated_bytes,
    };
  }

  async close() {
    await this.client.close();
  }

  async dispose() {
    await this.close();
  }

  static async load(path) {
    const client = new SidecarClient({ load: path, kind: 'dense' });
    const ready = await client.ready;
    const index = Object.create(TurboQuantIndex.prototype);
    index.dim = ready.dim;
    index.bitWidth = ready.bits;
    index.client = client;
    return index;
  }
}

class IdMapIndex {
  constructor(dim, bits = 4) {
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new TurbovecError('ERR_TURBOVEC_INVALID_INPUT', 'dim must be a positive integer');
    }
    this.dim = dim;
    this.bitWidth = bits;
    this.client = new SidecarClient({ dim, bits, kind: 'id_map' });
  }

  async addWithIds(vectors, ids) {
    const rows = vectors.length / this.dim;
    if (!Number.isInteger(rows) || ids.length !== rows) {
      throw new TurbovecError('ERR_TURBOVEC_INVALID_INPUT', 'vectors and ids must describe the same rows');
    }
    const chunkRows = addChunkRows(this.dim);
    for (let start = 0; start < rows; start += chunkRows) {
      const end = Math.min(rows, start + chunkRows);
      const vectorSlice = vectors.subarray(start * this.dim, end * this.dim);
      const idSlice = ids.subarray(start, end);
      await this.client.request(
        'add_with_ids',
        { rows: end - start },
        Buffer.concat([floatPayload(vectorSlice), u64Payload(idSlice)]),
      );
    }
  }

  async search(queries, k, allowlist) {
    const nq = queries.length / this.dim;
    if (!Number.isInteger(nq)) {
      throw new TurbovecError('ERR_TURBOVEC_INVALID_INPUT', 'queries length must be a multiple of dim');
    }
    const queryPayload = floatPayload(queries);
    const payload = allowlist ? Buffer.concat([queryPayload, u64Payload(allowlist)]) : queryPayload;
    const { header, payload: result } = await this.client.request('search', { nq, k }, payload);
    const scores = new Float32Array(header.nq * header.k);
    for (let i = 0; i < scores.length; i += 1) scores[i] = result.readFloatLE(i * 4);
    const ids = new BigUint64Array(header.nq * header.k);
    let offset = header.nq * header.k * 4;
    for (let i = 0; i < ids.length; i += 1) {
      ids[i] = result.readBigUInt64LE(offset);
      offset += 8;
    }
    return { scores, ids, nq: header.nq, k: header.k };
  }

  async remove(id) {
    const { header } = await this.client.request('remove', { item: id.toString() });
    return header.removed;
  }

  async contains(id) {
    const { header } = await this.client.request('contains', { item: id.toString() });
    return header.contains;
  }

  async iterIds() {
    const { header, payload } = await this.client.request('iter_ids');
    const ids = new BigUint64Array(header.count);
    for (let i = 0; i < ids.length; i += 1) ids[i] = payload.readBigUInt64LE(i * 8);
    return ids;
  }

  async checkpoint(path, durable = true) {
    await this.client.request('checkpoint', { path, durable });
  }

  async write(path, durable = true) {
    await this.checkpoint(path, durable);
  }

  async sync(path) {
    await this.client.request('sync', { path });
  }

  async calibrate(sample) {
    await this.client.request('calibrate', {}, floatPayload(sample));
  }

  async prepare() {
    await this.client.request('prepare');
  }

  async stats() {
    const { header } = await this.client.request('stats');
    return {
      kind: header.kind,
      dim: header.dim,
      bits: header.bits,
      len: header.len,
      serialized_bytes: header.serialized_bytes,
      estimated_bytes: header.estimated_bytes,
    };
  }

  async close() {
    await this.client.close();
  }

  async dispose() {
    await this.close();
  }

  static async load(path) {
    const client = new SidecarClient({ load: path, kind: 'id_map' });
    const ready = await client.ready;
    const index = Object.create(IdMapIndex.prototype);
    index.dim = ready.dim;
    index.bitWidth = ready.bits;
    index.client = client;
    return index;
  }
}

module.exports = {
  TurboQuantIndex,
  IdMapIndex,
  TurbovecError,
  toTurbovecError,
};
