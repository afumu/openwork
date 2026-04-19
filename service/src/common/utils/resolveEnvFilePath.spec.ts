import { resolveEnvFilePath } from './resolveEnvFilePath';

declare const describe: any;
declare const expect: any;
declare const it: any;

describe('resolveEnvFilePath', () => {
  it('prefers the service root env file when started from the repository root', () => {
    const resolved = resolveEnvFilePath({
      cwd: '/Users/apple/workplace-frontend/openwork',
      filename: '.env',
      runtimeDir: '/Users/apple/workplace-frontend/openwork/service/dist',
      fileExists: candidate =>
        candidate === '/Users/apple/workplace-frontend/openwork/service/.env',
    });

    expect(resolved).toBe('/Users/apple/workplace-frontend/openwork/service/.env');
  });

  it('falls back to the current working directory env when already running inside service', () => {
    const resolved = resolveEnvFilePath({
      cwd: '/Users/apple/workplace-frontend/openwork/service',
      filename: '.env',
      runtimeDir: '/Users/apple/workplace-frontend/openwork/service/dist',
      fileExists: candidate =>
        candidate === '/Users/apple/workplace-frontend/openwork/service/.env',
    });

    expect(resolved).toBe('/Users/apple/workplace-frontend/openwork/service/.env');
  });
});
