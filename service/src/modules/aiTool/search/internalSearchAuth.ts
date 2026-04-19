import { createHash, timingSafeEqual } from 'crypto';

const OPENWORK_INTERNAL_SEARCH_SCOPE = 'openwork-internal-search';

export function deriveInternalSearchToken(jwtSecret: string): string {
  return createHash('sha256')
    .update(`${OPENWORK_INTERNAL_SEARCH_SCOPE}:${jwtSecret}`)
    .digest('hex');
}

export function isInternalSearchTokenValid(candidate: string, jwtSecret: string): boolean {
  if (!candidate?.trim() || !jwtSecret?.trim()) {
    return false;
  }

  const expected = deriveInternalSearchToken(jwtSecret);
  const candidateBuffer = Buffer.from(candidate.trim());
  const expectedBuffer = Buffer.from(expected);

  if (candidateBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(candidateBuffer, expectedBuffer);
}
