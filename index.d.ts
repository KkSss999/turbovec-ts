export interface SearchResult {
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

export declare class TurboQuantIndex {
  constructor(dim: number, bitWidth?: number | null);
  add(vectors: Float32Array): Promise<void>;
  swapRemove(index: number): Promise<number>;
  search(queries: Float32Array, k: number, mask?: Uint8Array | null): Promise<SearchResult>;
  toBytes(): Buffer;
  static fromBytes(data: Buffer): TurboQuantIndex;
  static load(path: string): Promise<TurboQuantIndex>;
  write(path: string, durable?: boolean | null): Promise<void>;
  sync(path: string): Promise<void>;
  calibrate(sample: Float32Array): Promise<void>;
  prepare(): Promise<void>;
  dispose(): void;
  get calibrationState(): string;
  get length(): number;
  get dim(): number;
  get bitWidth(): number;
}

export declare class IdMapIndex {
  constructor(dim: number, bitWidth?: number | null);
  addWithIds(vectors: Float32Array, ids: BigUint64Array): Promise<void>;
  remove(id: bigint): Promise<boolean>;
  contains(id: bigint): boolean;
  iterIds(): BigUint64Array;
  search(
    queries: Float32Array,
    k: number,
    allowlist?: BigUint64Array | null,
  ): Promise<IdSearchResult>;
  toBytes(): Buffer;
  static fromBytes(data: Buffer): IdMapIndex;
  static load(path: string): Promise<IdMapIndex>;
  write(path: string, durable?: boolean | null): Promise<void>;
  sync(path: string): Promise<void>;
  calibrate(sample: Float32Array): Promise<void>;
  prepare(): Promise<void>;
  dispose(): void;
  get calibrationState(): string;
  get length(): number;
  get dim(): number;
  get bitWidth(): number;
}
