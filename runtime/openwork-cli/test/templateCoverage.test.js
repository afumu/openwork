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

  it('includes React type packages for strict TypeScript templates', async () => {
    const registry = await loadTemplates();
    const reactTemplateNames = new Set(['vite-react', 'nextjs']);

    for (const template of registry.templates.filter(item => reactTemplateNames.has(item.name))) {
      const templateDir = path.resolve(getTemplatesDir(), template.location);
      const packageJson = JSON.parse(await readFile(path.join(templateDir, 'package.json'), 'utf8'));
      assert.ok(
        packageJson.devDependencies?.['@types/react'],
        `${template.name} should include @types/react`,
      );
      assert.ok(
        packageJson.devDependencies?.['@types/react-dom'],
        `${template.name} should include @types/react-dom`,
      );
    }
  });

  it('runs Vite templates behind the OpenWork proxy wrapper in dev mode', async () => {
    const registry = await loadTemplates();

    for (const template of registry.templates.filter(item => item.name.startsWith('vite-'))) {
      const templateDir = path.resolve(getTemplatesDir(), template.location);
      const config = JSON.parse(
        await readFile(path.join(templateDir, 'template.openwork.json'), 'utf8'),
      );
      const viteConfig = await readFile(path.join(templateDir, 'vite.config.ts'), 'utf8');

      assert.doesNotMatch(viteConfig, /base:\s*['"`]/, `${template.name} should not set Vite base`);
      assert.match(
        viteConfig,
        /OPENWORK_DISABLE_HMR/,
        `${template.name} should be able to disable Vite HMR behind the proxy`,
      );
      assert.deepEqual(
        config.commands.dev.slice(0, 3),
        [
          'openwork',
          'vite-proxy',
          '--public-port',
        ],
        `${template.name}.dev should start the OpenWork Vite proxy wrapper`,
      );
      assert.equal(config.commands.dev[3], '<%= port %>');
      assert.equal(config.commands.dev[4], '--target-port');
      assert.equal(config.commands.dev[5], '<%= proxyTargetPort %>');
      assert.equal(config.commands.dev[6], '--base');
      assert.equal(config.commands.dev[7], '/proxy/<%= port %>/');
      assert.deepEqual(
        config.commands.start.slice(0, 3),
        [
          'openwork',
          'vite-proxy',
          '--public-port',
        ],
        `${template.name}.start should start the OpenWork Vite proxy wrapper`,
      );
    }
  });
});
