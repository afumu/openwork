import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
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

  it('uses npm lifecycle commands because the runtime image does not bundle pnpm', async () => {
    const registry = await loadTemplates();

    for (const template of registry.templates) {
      const templateDir = path.resolve(getTemplatesDir(), template.location);
      const config = JSON.parse(
        await readFile(path.join(templateDir, 'template.openwork.json'), 'utf8'),
      );
      for (const [commandName, command] of Object.entries(config.commands)) {
        assert.notEqual(
          command[0],
          'pnpm',
          `${template.name}.${commandName} should not require pnpm`,
        );
      }
    }
  });

  it('pins Vite templates to Vite 6 for the current runtime Node version', async () => {
    const registry = await loadTemplates();

    for (const template of registry.templates.filter(item => item.name.startsWith('vite-'))) {
      const templateDir = path.resolve(getTemplatesDir(), template.location);
      const packageJson = JSON.parse(await readFile(path.join(templateDir, 'package.json'), 'utf8'));
      assert.match(
        packageJson.dependencies.vite,
        /^6\./,
        `${template.name} should stay on Vite 6`,
      );
    }
  });
});
