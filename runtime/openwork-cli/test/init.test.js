import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve('bin/openwork.js');

async function createTempWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), 'openwork-cli-'));
}

async function runOpenwork(args, options = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: path.resolve('.'),
      ...options,
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

describe('openwork init', () => {
  it('initializes native-static into an empty workspace', async () => {
    const workspace = await createTempWorkspace();

    try {
      const result = await runOpenwork([
        'init',
        'demo-site',
        '--template',
        'native-static',
        '--workspace',
        workspace,
        '--json',
      ]);

      assert.equal(result.code, 0);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.template, 'native-static');
      assert.equal(payload.workspace, workspace);

      const html = await readFile(path.join(workspace, 'index.html'), 'utf8');
      assert.match(html, /demo-site/);

      const agents = await readFile(path.join(workspace, 'AGENTS.md'), 'utf8');
      assert.match(agents, /Native Static/);

      const projectConfig = JSON.parse(
        await readFile(path.join(workspace, '.openwork/project.json'), 'utf8'),
      );
      assert.equal(projectConfig.name, 'demo-site');
      assert.equal(projectConfig.template, 'native-static');
      assert.deepEqual(projectConfig.commands.dev, [
        'python',
        '-m',
        'http.server',
        '5000',
        '--bind',
        '0.0.0.0',
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it('rejects a non-empty workspace unless force is set', async () => {
    const workspace = await createTempWorkspace();

    try {
      await writeFile(path.join(workspace, 'existing.txt'), 'hello');

      const result = await runOpenwork([
        'init',
        '--template',
        'native-static',
        '--workspace',
        workspace,
        '--json',
      ]);

      assert.equal(result.code, 1);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, false);
      assert.equal(payload.code, 'WORKSPACE_NOT_EMPTY');
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it('renders port parameters into project lifecycle commands', async () => {
    const workspace = await createTempWorkspace();

    try {
      const result = await runOpenwork([
        'init',
        'demo-site',
        '--template',
        'native-static',
        '--workspace',
        workspace,
        '--port',
        '5050',
        '--json',
      ]);

      assert.equal(result.code, 0);
      const projectConfig = JSON.parse(
        await readFile(path.join(workspace, '.openwork/project.json'), 'utf8'),
      );
      assert.equal(projectConfig.devPort, 5050);
      assert.deepEqual(projectConfig.commands.dev, [
        'python',
        '-m',
        'http.server',
        '5050',
        '--bind',
        '0.0.0.0',
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
