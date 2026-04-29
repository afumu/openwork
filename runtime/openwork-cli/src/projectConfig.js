import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OpenWorkCliError } from './errors.js';

export function getOpenworkDir(workspace) {
  return path.join(workspace, '.openwork');
}

export function getProjectConfigPath(workspace) {
  return path.join(getOpenworkDir(workspace), 'project.json');
}

export function getRuntimeConfigPath(workspace) {
  return path.join(getOpenworkDir(workspace), 'runtime.json');
}

export async function writeProjectConfig(workspace, config) {
  await mkdir(getOpenworkDir(workspace), { recursive: true });
  await writeFile(getProjectConfigPath(workspace), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export async function readProjectConfig(workspace) {
  try {
    return JSON.parse(await readFile(getProjectConfigPath(workspace), 'utf8'));
  } catch (error) {
    throw new OpenWorkCliError(
      'PROJECT_CONFIG_NOT_FOUND',
      `Project config not found in ${workspace}`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

export async function writeRuntimeConfig(workspace, config) {
  await mkdir(getOpenworkDir(workspace), { recursive: true });
  await writeFile(getRuntimeConfigPath(workspace), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
