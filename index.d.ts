export interface DenseSearchResult {
  scores: Float32Array;
  indices: number[];
  nq: number;
  k: number;
}

export interface IdSearchResult {
  scores: Float32Array;
  ids: BigUint64Array;
  nq: number;
  k: number;
}

export interface IndexStats {
  kind: 'dense' | 'id_map';
  dim: number;
  bits: number;
  len: number;
  serialized_bytes: number;
  estimated_bytes: number;
}

export declare class TurbovecError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions);
}

export declare function toTurbovecError(error: unknown): Error;

/**
 * Dense vector index. The index lives in a bundled Rust sidecar process; the
 * package starts and stops that process for you.
 */
export declare class TurboQuantIndex {
  constructor(dim: number, bits?: number);
  readonly dim: number;
  readonly bitWidth: number;
  add(vectors: Float32Array): Promise<void>;
  swapRemove(slot: number): Promise<number>;
  search(queries: Float32Array, k: number, mask?: Uint8Array | null): Promise<DenseSearchResult>;
  checkpoint(path: string, durable?: boolean): Promise<void>;
  write(path: string, durable?: boolean): Promise<void>;
  sync(path: string): Promise<void>;
  calibrate(sample: Float32Array): Promise<void>;
  prepare(): Promise<void>;
  stats(): Promise<IndexStats>;
  close(): Promise<void>;
  dispose(): Promise<void>;
  static load(path: string): Promise<TurboQuantIndex>;
}

/** Dense vector index with stable external u64 ids. */
export declare class IdMapIndex {
  constructor(dim: number, bits?: number);
  readonly dim: number;
  readonly bitWidth: number;
  addWithIds(vectors: Float32Array, ids: BigUint64Array): Promise<void>;
  search(
    queries: Float32Array,
    k: number,
    allowlist?: BigUint64Array | null,
  ): Promise<IdSearchResult>;
  remove(id: bigint): Promise<boolean>;
  contains(id: bigint): Promise<boolean>;
  iterIds(): Promise<BigUint64Array>;
  checkpoint(path: string, durable?: boolean): Promise<void>;
  write(path: string, durable?: boolean): Promise<void>;
  sync(path: string): Promise<void>;
  calibrate(sample: Float32Array): Promise<void>;
  prepare(): Promise<void>;
  stats(): Promise<IndexStats>;
  close(): Promise<void>;
  dispose(): Promise<void>;
  static load(path: string): Promise<IdMapIndex>;
}
