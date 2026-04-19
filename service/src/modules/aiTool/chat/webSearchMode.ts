export function resolveRequestedWebSearchEnabled(input: {
  researchMode?: boolean;
  usingNetwork?: boolean;
}): boolean {
  return Boolean(input.usingNetwork || input.researchMode);
}

export function resolveRequestedWebSearchLimit(input: {
  researchMode?: boolean;
  usingNetwork?: boolean;
}): number {
  if (!resolveRequestedWebSearchEnabled(input)) {
    return 0;
  }

  if (input.researchMode) {
    return 12;
  }

  return 8;
}
