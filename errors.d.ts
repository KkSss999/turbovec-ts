export type TurbovecErrorCode =
  | 'ERR_TURBOVEC_DISPOSED'
  | 'ERR_TURBOVEC_LOCKED'
  | 'ERR_TURBOVEC_INVALID_INPUT'
  | 'ERR_TURBOVEC_IO'
  | 'ERR_TURBOVEC_NATIVE'
  | 'ERR_TURBOVEC_UNSUPPORTED'
  | 'ERR_TURBOVEC_TASK';

export declare class TurbovecError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions);
}

export declare function toTurbovecError(error: unknown): Error;
