import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadTemplates, recommendTemplate } from '../src/templateRegistry.js';

describe('template registry', () => {
  it('loads bundled templates from templates.json', async () => {
    const registry = await loadTemplates();

    assert.equal(registry.schemaVersion, 1);
    assert.deepEqual(
      registry.templates.map(template => template.name),
      ['native-static', 'vite-react', 'vite-vue', 'vite-vue-admin', 'nextjs'],
    );
  });

  it('recommends the admin Vue template for Vue dashboard prompts', async () => {
    const registry = await loadTemplates();
    const recommendation = recommendTemplate('帮我做一个 Vue 管理后台', registry);

    assert.equal(recommendation.template, 'vite-vue-admin');
    assert.equal(recommendation.confidence, 0.88);
    assert.match(recommendation.reason, /Vue/);
  });
});
