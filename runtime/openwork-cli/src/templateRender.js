import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OpenWorkCliError } from './errors.js';

const ignoredNames = new Set([
  '.DS_Store',
  'node_modules',
  'template.openwork.json',
  'template.config.js',
  'template.config.ts',
]);

const renderExtensions = new Set([
  '',
  '.css',
  '.env',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sh',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.yaml',
  '.yml',
]);

function shouldIgnore(relativePath) {
  return relativePath.split(path.sep).some(part => ignoredNames.has(part));
}

function shouldRender(filePath) {
  return renderExtensions.has(path.extname(filePath).toLowerCase());
}

function convertDotfileName(relativePath) {
  const basename = path.basename(relativePath);
  if (basename === '_gitignore') return path.join(path.dirname(relativePath), '.gitignore');
  if (basename === '_npmrc') return path.join(path.dirname(relativePath), '.npmrc');
  return relativePath;
}

async function collectFiles(dir, baseDir = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const batches = await Promise.all(
    entries.map(entry => {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      if (shouldIgnore(relativePath)) return [];
      if (entry.isDirectory()) return collectFiles(fullPath, baseDir);
      if (entry.isFile()) return [relativePath];
      return [];
    }),
  );
  return batches.flat();
}

export function renderString(content, context) {
  return content.replace(/<%=\s*([a-zA-Z_$][\w$]*)\s*%>/g, (_match, key) => {
    const value = context[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function assertWorkspaceWritable(workspace, { force }) {
  await mkdir(workspace, { recursive: true });
  const entries = (await readdir(workspace)).filter(entry => entry !== '.openwork');
  if (!force && entries.length > 0) {
    throw new OpenWorkCliError(
      'WORKSPACE_NOT_EMPTY',
      'Workspace is not empty. Use --force to overwrite conflicting files.',
      { workspace },
    );
  }
}

export async function renderTemplateToWorkspace({ context, force, templatePath, workspace }) {
  await assertWorkspaceWritable(workspace, { force });
  const files = await collectFiles(templatePath);
  const conflicts = [];

  for (const file of files) {
    const destination = path.join(workspace, convertDotfileName(file));
    if (!force && (await pathExists(destination))) conflicts.push(convertDotfileName(file));
  }

  if (conflicts.length) {
    throw new OpenWorkCliError('FILE_CONFLICT', 'Template files conflict with workspace files', {
      conflicts,
      workspace,
    });
  }

  for (const file of files) {
    const source = path.join(templatePath, file);
    const destination = path.join(workspace, convertDotfileName(file));
    await mkdir(path.dirname(destination), { recursive: true });
    const sourceStat = await stat(source);
    if (!sourceStat.isFile()) continue;

    if (shouldRender(source)) {
      const content = renderString(await readFile(source, 'utf8'), context);
      await writeFile(destination, content, 'utf8');
    } else {
      await copyFile(source, destination);
    }
  }

  return { filesWritten: files.length };
}
