'use strict';

class TurbovecError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'TurbovecError';
    this.code = code;
  }
}

const CODE_PREFIX = /^(ERR_TURBOVEC_[A-Z_]+):\s*/;

function toTurbovecError(error) {
  if (error instanceof TurbovecError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const match = CODE_PREFIX.exec(message);
  if (!match) return error instanceof Error ? error : new Error(message);
  const code = match[1];
  return new TurbovecError(code, message.slice(match[0].length), { cause: error });
}

module.exports = { TurbovecError, toTurbovecError };
