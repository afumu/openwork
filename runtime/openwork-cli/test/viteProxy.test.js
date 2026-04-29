import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildViteClientNoopScript,
  isViteClientRequest,
  rewriteViteProxyText,
} from '../src/viteProxy.js';

describe('Vite proxy response rewriting', () => {
  it('prefixes Vite absolute dev resource URLs with the public proxy base', () => {
    const input = [
      '<script type="module" src="/@vite/client"></script>',
      '<script type="module">import RefreshRuntime from "/@react-refresh";</script>',
      'import "/src/style.css";',
      'import "/src/main.tsx";',
    ].join('\n');

    assert.equal(
      rewriteViteProxyText(input, '/proxy/9000/'),
      [
        '<script type="module" src="/proxy/9000/@vite/client"></script>',
        '<script type="module">import RefreshRuntime from "/proxy/9000/@react-refresh";</script>',
        'import "/proxy/9000/src/style.css";',
        'import "/proxy/9000/src/main.tsx";',
      ].join('\n'),
    );
  });

  it('does not rewrite already-prefixed or external URLs', () => {
    const input = [
      'import "/proxy/9000/src/main.tsx";',
      'const cdn = "https://cdn.example.com/@vite/client";',
    ].join('\n');

    assert.equal(rewriteViteProxyText(input, '/proxy/9000/'), input);
  });

  it('detects Vite client requests so the proxy can disable the websocket client', () => {
    assert.equal(isViteClientRequest('/@vite/client'), true);
    assert.equal(isViteClientRequest('/@vite/client?direct'), true);
    assert.equal(isViteClientRequest('/src/main.tsx'), false);
  });

  it('provides no-op exports expected by Vite transformed modules', () => {
    const script = buildViteClientNoopScript();

    assert.match(script, /export function createHotContext/);
    assert.match(script, /export function updateStyle/);
    assert.match(script, /export function removeStyle/);
  });
});
