export type TurbovecErrorCode =
  | 'ERR_TURBOVEC_DISPOSED'
  | 'ERR_TURBOVEC_LOCKED'
  | 'ERR_TURBOVEC_INVALID_INPUT'
  | 'ERR_TURBOVEC_IO'
  | 'ERR_TURBOVEC_NATIVE'
  | 'ERR_TURBOVEC_UNSUPPORTED'
  | 'ERR_TURBOVEC_TASK';

const CODE_PREFIX = /^(ERR_TURBOVEC_[A-Z_]+):\s*/;

export class TurbovecError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TurbovecError';
    this.code = code;
  }
}

/**
 * Convert a native error carrying an `ERR_TURBOVEC_*` message prefix into a
 * `TurbovecError` with a stable `code`. Other errors are returned unchanged.
 */
export function toTurbovecError(error: unknown): Error {
  if (error instanceof TurbovecError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const match = CODE_PREFIX.exec(message);
  const code = match?.[1];
  if (!match || !code) return error instanceof Error ? error : new Error(message);

  return new TurbovecError(code, message.slice(match[0].length), { cause: error });
}
