/** Stable error codes surfaced by the native wrapper. */
export type TurbovecErrorCode =
  | 'ERR_TURBOVEC_DISPOSED'
  | 'ERR_TURBOVEC_LOCKED'
  | 'ERR_TURBOVEC_INVALID_INPUT'
  | 'ERR_TURBOVEC_IO'
  | 'ERR_TURBOVEC_NATIVE'
  | 'ERR_TURBOVEC_UNSUPPORTED'
  | 'ERR_TURBOVEC_TASK';

/** Error type used for native failures that carry a `TurbovecErrorCode`. */
export declare class TurbovecError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions);
}

/**
 * Convert an error carrying an `ERR_TURBOVEC_*` message prefix into a `TurbovecError`.
 * Other errors are returned unchanged.
 */
export declare function toTurbovecError(error: unknown): Error;
