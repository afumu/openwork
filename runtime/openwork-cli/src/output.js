export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printText(message) {
  process.stdout.write(`${message}\n`);
}

export function formatError(error) {
  return {
    ok: false,
    code: error.code || 'COMMAND_FAILED',
    message: error.message || String(error),
    ...(error.details && Object.keys(error.details).length ? { details: error.details } : {}),
  };
}
