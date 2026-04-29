import http from 'node:http';
import { spawn } from 'node:child_process';

const DEFAULT_PUBLIC_HOST = '0.0.0.0';

function readOption(args, longName) {
  const index = args.indexOf(longName);
  return index >= 0 ? args[index + 1] : undefined;
}

function normalizeBase(base) {
  const normalized = String(base || '/').trim();
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

export function rewriteViteProxyText(content, publicBase) {
  const base = normalizeBase(publicBase);
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const viteAbsolutePath = String.raw`(@vite/client|@react-refresh|src/|assets/|@id/|@fs/|node_modules/)`;
  const alreadyPrefixed = new RegExp(`${escapedBase}${viteAbsolutePath}`, 'g');
  const placeholder = '__OPENWORK_ALREADY_PREFIXED_VITE_PATH__';

  return String(content)
    .replace(alreadyPrefixed, `${placeholder}$1`)
    .replace(new RegExp(`(["'\`(=:\\s])/${viteAbsolutePath}`, 'g'), `$1${base}$2`)
    .replace(new RegExp(placeholder, 'g'), base);
}

function shouldRewriteResponse(contentType = '') {
  return /text\/html|javascript|typescript|text\/css|application\/json/.test(contentType);
}

function stripPublicBase(pathWithQuery, publicBase) {
  const base = normalizeBase(publicBase);
  if (pathWithQuery === base.slice(0, -1)) return '/';
  if (pathWithQuery.startsWith(base)) {
    return `/${pathWithQuery.slice(base.length)}`;
  }
  return pathWithQuery || '/';
}

export function isViteClientRequest(pathWithQuery) {
  return String(pathWithQuery || '').split('?')[0] === '/@vite/client';
}

export function buildViteClientNoopScript() {
  return `
const hotContexts = new Map();

export function createHotContext(ownerPath) {
  const context = {
    accept() {},
    data: {},
    decline() {},
    dispose() {},
    invalidate() {},
    on() {},
    prune() {},
    send() {},
  };
  hotContexts.set(ownerPath, context);
  return context;
}

export function updateStyle(id, content) {
  let style = document.querySelector(\`style[data-vite-dev-id="\${id}"]\`);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    document.head.appendChild(style);
  }
  style.textContent = content;
}

export function removeStyle(id) {
  document.querySelector(\`style[data-vite-dev-id="\${id}"]\`)?.remove();
}

export function injectQuery(url, queryToInject) {
  const resolvedUrl = new URL(url, 'http://openwork.local');
  const query = queryToInject.startsWith('?') ? queryToInject.slice(1) : queryToInject;
  const params = new URLSearchParams(query);
  for (const [key, value] of params) resolvedUrl.searchParams.set(key, value);
  return resolvedUrl.pathname + resolvedUrl.search + resolvedUrl.hash;
}

console.debug('[openwork] Vite websocket client disabled for proxied preview');
`;
}

function writeViteClientNoop(res) {
  res.writeHead(200, {
    'cache-control': 'no-cache',
    'content-type': 'application/javascript; charset=utf-8',
  });
  res.end(buildViteClientNoopScript());
}

function proxyRequest(req, res, input) {
  const upstreamPath = stripPublicBase(req.url || '/', input.publicBase);
  if (isViteClientRequest(upstreamPath)) {
    writeViteClientNoop(res);
    return;
  }

  const upstream = http.request(
    {
      headers: {
        ...req.headers,
        host: `127.0.0.1:${input.targetPort}`,
      },
      hostname: '127.0.0.1',
      method: req.method,
      path: upstreamPath,
      port: input.targetPort,
    },
    upstreamRes => {
      const headers = { ...upstreamRes.headers };
      const contentType = String(headers['content-type'] || '');

      if (!shouldRewriteResponse(contentType)) {
        res.writeHead(upstreamRes.statusCode || 502, headers);
        upstreamRes.pipe(res);
        return;
      }

      const chunks = [];
      upstreamRes.on('data', chunk => chunks.push(chunk));
      upstreamRes.on('end', () => {
        const original = Buffer.concat(chunks).toString('utf8');
        const rewritten = rewriteViteProxyText(original, input.publicBase);
        delete headers['content-length'];
        res.writeHead(upstreamRes.statusCode || 200, headers);
        res.end(rewritten);
      });
    },
  );

  upstream.on('error', error => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`OpenWork Vite proxy error: ${error instanceof Error ? error.message : String(error)}`);
  });

  req.pipe(upstream);
}

export async function runViteProxy(args) {
  const separatorIndex = args.indexOf('--');
  const proxyArgs = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args;
  const childCommand = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : [];
  const publicPort = Number(readOption(proxyArgs, '--public-port') || 9000);
  const targetPort = Number(readOption(proxyArgs, '--target-port') || publicPort + 1);
  const publicBase = normalizeBase(readOption(proxyArgs, '--base') || `/proxy/${publicPort}/`);

  if (!childCommand.length) {
    throw new Error('Missing Vite child command after --');
  }

  const child = spawn(childCommand[0], childCommand.slice(1), {
    env: {
      ...process.env,
      OPENWORK_DISABLE_HMR: '1',
    },
    stdio: 'inherit',
  });

  const server = http.createServer((req, res) => {
    proxyRequest(req, res, { publicBase, targetPort });
  });

  const close = () => {
    server.close();
    if (!child.killed) child.kill('SIGTERM');
  };

  process.once('SIGINT', close);
  process.once('SIGTERM', close);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(publicPort, DEFAULT_PUBLIC_HOST, resolve);
  });

  process.stdout.write(
    `OpenWork Vite proxy listening on ${publicPort}, forwarding to ${targetPort} with base ${publicBase}\n`,
  );

  await new Promise(resolve => {
    child.once('exit', code => {
      server.close(() => {
        process.exitCode = code || 0;
        resolve();
      });
    });
  });
}
