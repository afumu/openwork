import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve('bin/openwork.js');

async function createWorkspaceWithProjectConfig(commands) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'openwork-cli-life-'));
  await mkdir(path.join(workspace, '.openwork'), { recursive: true });
  await writeFile(
    path.join(workspace, '.openwork/project.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        name: 'life-test',
        template: 'native-static',
        createdAt: '2026-04-29T00:00:00.000Z',
        workspace,
        devPort: 5000,
        commands,
      },
      null,
      2,
    ),
  );
  return workspace;
}

async function runOpenwork(args) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: path.resolve('.'),
    });
    return { code: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    return {
      code: error.code,
      stderr: error.stderr,
      stdout: error.stdout,
    };
  }
}

describe('lifecycle commands', () => {
  it('runs the configured build command and writes a log file', async () => {
    const workspace = await createWorkspaceWithProjectConfig({
      build: [process.execPath, '-e', "console.log('build ok')"],
    });

    try {
      const logFile = path.join(workspace, '.openwork/logs/build.log');
      const result = await runOpenwork([
        'build',
        '--workspace',
        workspace,
        '--log-file',
        logFile,
        '--json',
      ]);

      assert.equal(result.code, 0);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.command, 'build');
      assert.equal(payload.exitCode, 0);
      assert.match(await readFile(logFile, 'utf8'), /build ok/);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it('returns COMMAND_FAILED when a lifecycle command exits non-zero', async () => {
    const workspace = await createWorkspaceWithProjectConfig({
      build: [process.execPath, '-e', 'process.exit(7)'],
    });

    try {
      const result = await runOpenwork(['build', '--workspace', workspace, '--json']);

      assert.equal(result.code, 1);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, false);
      assert.equal(payload.code, 'COMMAND_FAILED');
      assert.equal(payload.details.exitCode, 7);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it('reports initialized project status', async () => {
    const workspace = await createWorkspaceWithProjectConfig({
      build: [],
    });

    try {
      const result = await runOpenwork(['status', '--workspace', workspace, '--json']);

      assert.equal(result.code, 0);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.initialized, true);
      assert.equal(payload.template, 'native-static');
      assert.equal(payload.workspace, workspace);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
