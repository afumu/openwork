import { normalizeArtifactReadPath } from './artifactPath';

declare const describe: any;
declare const expect: any;
declare const test: any;

describe('openAI chat artifact path normalization', () => {
  test('strips duplicated data/runId prefix when runId is provided', () => {
    expect(
      normalizeArtifactReadPath(
        'data/20260414_131408_us-iran-war-capital-markets/00_index.md',
        '20260414_131408_us-iran-war-capital-markets',
      ),
    ).toBe('00_index.md');
  });

  test('strips duplicated runId prefix without data segment when runId is provided', () => {
    expect(
      normalizeArtifactReadPath(
        '20260414_131408_us-iran-war-capital-markets/07_psc.md',
        '20260414_131408_us-iran-war-capital-markets',
      ),
    ).toBe('07_psc.md');
  });

  test('keeps workspace-relative paths unchanged when they are already normalized', () => {
    expect(
      normalizeArtifactReadPath(
        'data/shared-summary.md',
        '20260414_131408_us-iran-war-capital-markets',
      ),
    ).toBe('data/shared-summary.md');
  });

  test('keeps original path when runId is missing', () => {
    expect(
      normalizeArtifactReadPath(
        'data/20260414_131408_us-iran-war-capital-markets/00_index.md',
        undefined,
      ),
    ).toBe('data/20260414_131408_us-iran-war-capital-markets/00_index.md');
  });
});
