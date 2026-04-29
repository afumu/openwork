import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { getTemplatesDir, loadTemplates } from '../src/templateRegistry.js';

async function exists(filePath) {
  await access(filePath);
  return true;
}

describe('bundled template coverage', () => {
  it('provides a directory, config, and AGENTS.md for each registered template', async () => {
    const registry = await loadTemplates();

    for (const template of registry.templates) {
      const templateDir = path.resolve(getTemplatesDir(), template.location);
      assert.equal(await exists(templateDir), true, `${template.name} directory exists`);
      assert.equal(
        await exists(path.join(templateDir, 'template.openwork.json')),
        true,
        `${template.name} config exists`,
      );
      assert.equal(
        await exists(path.join(templateDir, 'AGENTS.md')),
        true,
        `${template.name} AGENTS.md exists`,
      );
    }
  });
});
