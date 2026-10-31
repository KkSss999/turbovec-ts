/**
 * Approximate nearest-neighbor result for `TurboQuantIndex`.
 *
 * `scores` and `indices` are flattened row-major with shape `[nq, k]`.
 */
export interface SearchResult {
  /** Similarity scores, shape `[nq, k]`. */
  scores: Float32Array;
  /** Slot indices, shape `[nq, k]`. */
  indices: number[];
  /** Number of query rows. */
  nq: number;
  /** Effective result count after clamping to the index size. */
  k: number;
}

/**
 * Approximate nearest-neighbor result for `IdMapIndex`.
 *
 * `scores` and `ids` are flattened row-major with shape `[nq, k]`.
 */
export interface IdSearchResult {
  /** Similarity scores, shape `[nq, k]`. */
  scores: Float32Array;
  /** External u64 ids, shape `[nq, k]`. */
  ids: BigUint64Array;
  /** Number of query rows. */
  nq: number;
  /** Effective result count after clamping to the index size. */
  k: number;
}

/** A dense vector index with no external ids. */
export declare class TurboQuantIndex {
  /**
   * Create an empty index.
   *
   * @param dim vector dimension; must be a positive multiple of 8
   * @param bitWidth quantization width; 2, 3, or 4 (default 4)
   */
  constructor(dim: number, bitWidth?: number | null);

  /**
   * Append one or more rows. `vectors.length` must be a multiple of `dim`.
   * Search results use the resulting slot indices.
   */
  add(vectors: Float32Array): Promise<void>;

  /**
   * Remove a slot by swapping the last slot into its position.
   * Returns the slot index that was moved (or the removed index when it was last).
   */
  swapRemove(index: number): Promise<number>;

  /** Reset to an empty index, keeping `dim` and `bitWidth`. */
  clear(): void;

  /** Exact byte length of the buffer returned by `toBytes()`. */
  get serializedLength(): number;

  /**
   * Search for the closest rows.
   *
   * @param queries flattened query rows; length must be a multiple of `dim`
   * @param k requested result count; clamped to the index size
   * @param mask optional per-slot byte mask; length must equal the index size
   */
  search(queries: Float32Array, k: number, mask?: Uint8Array | null): Promise<SearchResult>;

  /** Serialize the full index to a Buffer. */
  toBytes(): Buffer;

  /** Load an index from a Buffer produced by `toBytes()` or a compatible file. */
  static fromBytes(data: Buffer): TurboQuantIndex;

  /** Load an index from a `.tv` file. */
  static load(path: string): Promise<TurboQuantIndex>;

  /**
   * Write a durable full snapshot by default. `durable: false` skips fsync and is only
   * process-crash safe: after a power loss the new file may be missing or truncated, and the
   * previous file may also be lost. Use it only for disposable data.
   */
  write(path: string, durable?: boolean | null): Promise<void>;

  /**
   * Write a full snapshot by streaming to a temp file under the read lock, then renaming it.
   * Searches continue during the write; mutations wait. `durable: false` has the same
   * power-loss caveat as `write`.
   */
  checkpoint(path: string, durable?: boolean | null): Promise<void>;

  /**
   * Incrementally persist changes since the previous `sync` to `path`.
   * A destination is single-writer; do not call `sync` on the same path from multiple processes.
   */
  sync(path: string): Promise<void>;

  /** Calibrate from a representative sample. At least 2 rows with real variation are required. */
  calibrate(sample: Float32Array): Promise<void>;

  /** Prepare search structures after calibration or a batch of mutations. */
  prepare(): Promise<void>;

  /** Release native memory. Later calls fail with `ERR_TURBOVEC_DISPOSED`. Idempotent. */
  dispose(): void;

  /** `'uncalibrated'` or `'calibrated'`. */
  get calibrationState(): string;

  /** Number of stored vectors. */
  get length(): number;

  /** Vector dimension. */
  get dim(): number;

  /** Quantization width: 2, 3, or 4. */
  get bitWidth(): number;

  /** Whether `dispose()` has released the native index. */
  get isDisposed(): boolean;

  /** Conservative resident-size estimate for compressed data, not allocator overhead. */
  get estimatedBytes(): number;

  /** Post-commit checkpoint warning, or null when the last checkpoint was clean. */
  get lastWarning(): string | null;
}

/** A dense vector index with external u64 ids. */
export declare class IdMapIndex {
  /**
   * Create an empty index.
   *
   * @param dim vector dimension; must be a positive multiple of 8
   * @param bitWidth quantization width; 2, 3, or 4 (default 4)
   */
  constructor(dim: number, bitWidth?: number | null);

  /**
   * Append rows and their external ids. `vectors.length` must be a multiple of `dim`
   * and `ids.length` must equal the number of rows. Ids must be unique within the batch.
   */
  addWithIds(vectors: Float32Array, ids: BigUint64Array): Promise<void>;

  /** Reset to an empty index, keeping `dim` and `bitWidth`. */
  clear(): void;

  /** Exact byte length of the buffer returned by `toBytes()`. */
  get serializedLength(): number;

  /** Remove an external id. Returns false when it is not present. */
  remove(id: bigint): Promise<boolean>;

  /** Check whether an external id is present. */
  contains(id: bigint): boolean;

  /** Return the external ids in slot order. */
  iterIds(): BigUint64Array;

  /**
   * Search for the closest rows.
   *
   * @param queries flattened query rows; length must be a multiple of `dim`
   * @param k requested result count; clamped to the index size
   * @param allowlist optional non-empty ids to consider; every id must exist
   */
  search(
    queries: Float32Array,
    k: number,
    allowlist?: BigUint64Array | null,
  ): Promise<IdSearchResult>;

  /** Serialize the full index to a Buffer. */
  toBytes(): Buffer;

  /** Load an index from a Buffer produced by `toBytes()` or a compatible file. */
  static fromBytes(data: Buffer): IdMapIndex;

  /** Load an index from a `.tvim` file. */
  static load(path: string): Promise<IdMapIndex>;

  /**
   * Write a durable full snapshot by default. `durable: false` skips fsync and is only
   * process-crash safe: after a power loss the new file may be missing or truncated, and the
   * previous file may also be lost. Use it only for disposable data.
   */
  write(path: string, durable?: boolean | null): Promise<void>;

  /**
   * Write a full snapshot by streaming to a temp file under the read lock, then renaming it.
   * Searches continue during the write; mutations wait. `durable: false` has the same
   * power-loss caveat as `write`.
   */
  checkpoint(path: string, durable?: boolean | null): Promise<void>;

  /**
   * Incrementally persist changes since the previous `sync` to `path`.
   * A destination is single-writer; do not call `sync` on the same path from multiple processes.
   */
  sync(path: string): Promise<void>;

  /** Calibrate from a representative sample. At least 2 rows with real variation are required. */
  calibrate(sample: Float32Array): Promise<void>;

  /** Prepare search structures after calibration or a batch of mutations. */
  prepare(): Promise<void>;

  /** Release native memory. Later calls fail with `ERR_TURBOVEC_DISPOSED`. Idempotent. */
  dispose(): void;

  /** `'uncalibrated'` or `'calibrated'`. */
  get calibrationState(): string;

  /** Number of stored vectors. */
  get length(): number;

  /** Vector dimension. */
  get dim(): number;

  /** Quantization width: 2, 3, or 4. */
  get bitWidth(): number;

  /** Whether `dispose()` has released the native index. */
  get isDisposed(): boolean;

  /** Conservative resident-size estimate for compressed data, not allocator overhead. */
  get estimatedBytes(): number;

  /** Post-commit checkpoint warning, or null when the last checkpoint was clean. */
  get lastWarning(): string | null;
}
