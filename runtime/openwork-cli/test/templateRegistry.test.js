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
    assert.deepEqual(
      registry.templates.map(template => template.devPort),
      [9000, 9000, 9000, 9000, 9000],
    );
  });

  it('prints model-facing selection guidance with template use cases', async () => {
    const result = await execFileAsync(process.execPath, [cliPath, 'templates', '--json'], {
      cwd: path.resolve('.'),
    });
    const payload = JSON.parse(result.stdout);
    const adminTemplate = payload.templates.find(template => template.name === 'vite-vue-admin');

    assert.match(payload.selectionGuide, /choose the closest template/i);
    assert.match(payload.selectionGuide, /ask a short clarification/i);
    assert.ok(adminTemplate.useCases.includes('admin dashboards'));
    assert.ok(adminTemplate.avoidWhen.includes('public marketing sites'));
    assert.ok(adminTemplate.examples.includes('用户要一个管理后台、CRM、数据看板或表格系统'));
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
