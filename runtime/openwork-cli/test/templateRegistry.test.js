import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { describe, it } from 'node:test';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadTemplates } from '../src/templateRegistry.js';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve('bin/openwork.js');

describe('template registry', () => {
  it('loads bundled templates from templates.json', async () => {
    const registry = await loadTemplates();

    assert.equal(registry.schemaVersion, 1);
    assert.deepEqual(
      registry.templates.map(template => template.name),
      ['native-static', 'vite-react', 'vite-vue', 'vite-vue-admin', 'nextjs'],
    );
  });

  it('does not expose an internal recommendation command', async () => {
    let error;

    try {
      await execFileAsync(process.execPath, [cliPath, 'recommend', '帮我做一个 Vue 管理后台', '--json'], {
        cwd: path.resolve('.'),
      });
    } catch (caught) {
      error = caught;
    }

    assert.equal(error?.code, 1);
    const payload = JSON.parse(error.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, 'UNKNOWN_COMMAND');
  });
});
