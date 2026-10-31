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
  clear(): void;
  get serializedLength(): number;
  search(queries: Float32Array, k: number, mask?: Uint8Array | null): Promise<SearchResult>;
  toBytes(): Buffer;
  static fromBytes(data: Buffer): TurboQuantIndex;
  static load(path: string): Promise<TurboQuantIndex>;
  /**
   * Durable by default. `durable: false` skips fsync and is only process-crash safe:
   * after a power loss the new file may be missing or truncated, and the previous file
   * may also be lost. Use it only for disposable data.
   */
  write(path: string, durable?: boolean | null): Promise<void>;
  /**
   * Full snapshot. Same durability rules as `write`; `durable: false` is not
   * power-loss safe. See docs/versioned-checkpoint.md for a crash-safe fast pattern.
   */
  checkpoint(path: string, durable?: boolean | null): Promise<void>;
  sync(path: string): Promise<void>;
  calibrate(sample: Float32Array): Promise<void>;
  prepare(): Promise<void>;
  dispose(): void;
  get calibrationState(): string;
  get length(): number;
  get dim(): number;
  get bitWidth(): number;
  get isDisposed(): boolean;
  get estimatedBytes(): number;
  /** Post-commit checkpoint warning, or null when the last checkpoint was clean. */
  get lastWarning(): string | null;
}

export declare class IdMapIndex {
  constructor(dim: number, bitWidth?: number | null);
  addWithIds(vectors: Float32Array, ids: BigUint64Array): Promise<void>;
  clear(): void;
  get serializedLength(): number;
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
  /**
   * Durable by default. `durable: false` skips fsync and is only process-crash safe:
   * after a power loss the new file may be missing or truncated, and the previous file
   * may also be lost. Use it only for disposable data.
   */
  write(path: string, durable?: boolean | null): Promise<void>;
  /**
   * Full snapshot. Same durability rules as `write`; `durable: false` is not
   * power-loss safe. See docs/versioned-checkpoint.md for a crash-safe fast pattern.
   */
  checkpoint(path: string, durable?: boolean | null): Promise<void>;
  sync(path: string): Promise<void>;
  calibrate(sample: Float32Array): Promise<void>;
  prepare(): Promise<void>;
  dispose(): void;
  get calibrationState(): string;
  get length(): number;
  get dim(): number;
  get bitWidth(): number;
  get isDisposed(): boolean;
  get estimatedBytes(): number;
  /** Post-commit checkpoint warning, or null when the last checkpoint was clean. */
  get lastWarning(): string | null;
}
