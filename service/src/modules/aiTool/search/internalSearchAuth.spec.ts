import { deriveInternalSearchToken, isInternalSearchTokenValid } from './internalSearchAuth';

declare const describe: any;
declare const expect: any;
declare const it: any;

describe('internalSearchAuth', () => {
  it('derives a stable token and validates it safely', () => {
    const jwtSecret = 'jwt-secret-for-openwork';
    const token = deriveInternalSearchToken(jwtSecret);

    expect(token).toHaveLength(64);
    expect(token).toBe(deriveInternalSearchToken(jwtSecret));
    expect(isInternalSearchTokenValid(token, jwtSecret)).toBe(true);
    expect(isInternalSearchTokenValid(token, 'another-secret')).toBe(false);
    expect(isInternalSearchTokenValid('', jwtSecret)).toBe(false);
  });
});
