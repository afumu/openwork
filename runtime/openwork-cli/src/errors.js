export class OpenWorkCliError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OpenWorkCliError';
    this.code = code;
    this.details = details;
  }
}

export function toCliError(error) {
  if (error instanceof OpenWorkCliError) return error;
  return new OpenWorkCliError('COMMAND_FAILED', error instanceof Error ? error.message : String(error));
}
