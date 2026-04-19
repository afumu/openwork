import * as fs from 'fs';
import * as path from 'path';

type ResolveEnvFilePathOptions = {
  cwd?: string;
  filename?: string;
  fileExists?: (candidate: string) => boolean;
  runtimeDir?: string;
};

export function resolveEnvFilePath(options: ResolveEnvFilePathOptions = {}) {
  const filename = options.filename || '.env';
  const cwd = options.cwd || process.cwd();
  const runtimeDir = options.runtimeDir || __dirname;
  const fileExists = options.fileExists || fs.existsSync;

  const candidates = [
    path.join(cwd, filename),
    path.join(runtimeDir, '..', '..', '..', filename),
    path.join(runtimeDir, '..', filename),
    path.resolve(cwd, filename),
    path.join(cwd, '..', filename),
    path.join(cwd, 'dist', filename),
  ];

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return path.join(cwd, filename);
}
