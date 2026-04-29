import { execFileSync } from 'node:child_process';
import process from 'node:process';

const BASE_URL = process.env.OPENWORK_SERVICE_URL || 'http://127.0.0.1:9520/api';
const USERNAME = process.env.OPENWORK_VERIFY_USER || 'super';
const PASSWORD = process.env.OPENWORK_VERIFY_PASSWORD || '123456';

const templates = process.argv.slice(2);
const targets = templates.length
  ? templates
  : ['native-static', 'vite-react', 'vite-vue', 'vite-vue-admin', 'nextjs'];

const templateTitles = {
  'native-static': '一个简单 Todo 静态页面',
  'vite-react': '一个 React Todo 应用',
  'vite-vue': '一个 Vue Todo 应用',
  'vite-vue-admin': '一个 Vue 管理后台仪表盘',
  nextjs: '一个 Next.js Todo 应用',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok || payload?.success === false || payload?.code >= 400) {
    throw new Error(`${path} failed: HTTP ${response.status} ${text}`);
  }
  return payload;
}

async function login() {
  const payload = await requestJson('/auth/login', {
    body: JSON.stringify({ password: PASSWORD, username: USERNAME }),
    method: 'POST',
  });
  return payload.data;
}

async function createGroup(token, templateName) {
  const payload = await requestJson('/group/create', {
    body: JSON.stringify({
      modelConfig: {
        modelInfo: {
          deepThinkingType: 0,
          deduct: 1,
          deductType: 1,
          isFileUpload: 0,
          isImageUpload: 0,
          isMcpTool: 0,
          isNetworkSearch: 0,
          model: 'deepseek-v4-flash',
          modelName: 'deepseek',
        },
      },
      params: JSON.stringify({ verifyTemplate: templateName }),
    }),
    headers: { authorization: `Bearer ${token}` },
    method: 'POST',
  });
  return payload.data.id;
}

function parseStreamLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function runChat(token, groupId, templateName) {
  const appName = `ow-${templateName.replace(/[^a-z0-9-]/g, '-')}`;
  const prompt = [
    `请在当前 OpenWork 容器里创建 ${templateTitles[templateName] || templateName}。`,
    `这次必须使用 openwork 模板 "${templateName}"，项目名用 "${appName}"。`,
    '请按真实命令执行，不要只描述步骤：',
    '1. 先运行 openwork templates --json 确认模板存在。',
    `2. 如果 /workspace 非空，先安全清理 /workspace 下旧项目文件，包括隐藏文件，但不要删除 /workspace 本身。`,
    `3. 运行 openwork init ${appName} --template ${templateName} --install --dev --force --here --json。`,
    '4. 运行 openwork status --json。',
    '5. 访问 http://127.0.0.1:9000 验证 dev server。',
    '6. 运行 openwork build --json。',
    '最后只简要汇报实际执行结果。',
  ].join('\n');

  const response = await fetch(`${BASE_URL}/openwork/chat-process`, {
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      modelName: 'deepseek',
      options: { groupId },
      prompt,
    }),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok || !response.body) {
    throw new Error(`chat-process failed for ${templateName}: HTTP ${response.status} ${await response.text()}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finalEvent = null;
  let assistantChars = 0;
  let toolEvents = 0;

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = parseStreamLine(trimmed);
      if (!event) continue;
      finalEvent = event;
      if (event.content) assistantChars += String(event.content).length;
      if (event.tool_execution || event.tool_execution_delta) toolEvents += 1;
    }
  }

  return { assistantChars, finalEvent, toolEvents };
}

async function runtimeStatus(token, groupId) {
  const payload = await requestJson('/openwork/runtime/status', {
    body: JSON.stringify({ groupId }),
    headers: { authorization: `Bearer ${token}` },
    method: 'POST',
  });
  return payload.data;
}

async function verifyPreviewUrl(runtime, templateName) {
  const url = runtime?.preview?.url;
  if (!url) throw new Error(`Runtime status did not include preview.url for ${templateName}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok || !text.trim()) {
      throw new Error(`Preview URL failed for ${templateName}: HTTP ${response.status}`);
    }
    const assets = [];
    if (templateName === 'vite-react') {
      assets.push('@vite/client', '@react-refresh', 'src/main.tsx');
    } else if (templateName === 'vite-vue' || templateName === 'vite-vue-admin') {
      assets.push('@vite/client', 'src/main.ts');
    }

    const assetResults = [];
    for (const assetPath of assets) {
      const assetUrl = `${url.replace(/\/+$/g, '')}/${assetPath}`;
      const assetResponse = await fetch(assetUrl, { signal: controller.signal });
      const assetText = await assetResponse.text();
      if (!assetResponse.ok || !assetText.trim()) {
        throw new Error(
          `Preview asset failed for ${templateName}: HTTP ${assetResponse.status} ${assetUrl}`,
        );
      }
      assetResults.push({
        path: assetPath,
        status: assetResponse.status,
        url: assetUrl,
      });
    }

    return {
      assets: assetResults,
      length: text.length,
      preview: text.slice(0, 160),
      status: response.status,
      url,
    };
  } finally {
    clearTimeout(timer);
  }
}

function docker(args) {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

function findContainer(groupId) {
  const output = docker([
    'ps',
    '-a',
    '--filter',
    `label=groupId=${groupId}`,
    '--filter',
    'label=runtimeKind=openwork-agent',
    '--format',
    '{{.ID}} {{.Names}} {{.Status}}',
  ]);
  if (!output) return null;
  const [id, name, ...statusParts] = output.split(/\s+/);
  return { id, name, status: statusParts.join(' ') };
}

function execInContainer(containerId, command, timeoutSeconds = 120) {
  return docker(['exec', containerId, 'sh', '-lc', `timeout ${timeoutSeconds}s ${command}`]);
}

async function verifyContainer(groupId, templateName) {
  let container = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    container = findContainer(groupId);
    if (container) break;
    await sleep(1000);
  }
  if (!container) throw new Error(`No sandbox container found for group ${groupId}`);

  const status = execInContainer(container.id, 'openwork status --workspace /workspace --json', 30);
  const statusJson = JSON.parse(status);
  if (statusJson.template !== templateName) {
    throw new Error(`Expected ${templateName}, got ${statusJson.template}`);
  }

  const home = execInContainer(
    container.id,
    'curl -fsS http://127.0.0.1:9000 | head -c 300',
    30,
  );
  if (!home.trim()) throw new Error(`Dev server returned empty body for ${templateName}`);

  const build = execInContainer(container.id, 'openwork build --workspace /workspace --json', 180);
  const buildJson = JSON.parse(build);
  if (!buildJson.ok) throw new Error(`Build failed for ${templateName}: ${build}`);

  return { build: buildJson, container, homePreview: home.slice(0, 160), status: statusJson };
}

const token = await login();
const results = [];

for (const templateName of targets) {
  const groupId = await createGroup(token, templateName);
  console.log(`\n=== ${templateName} / group ${groupId} ===`);
  const chat = await runChat(token, groupId, templateName);
  const runtime = await runtimeStatus(token, groupId);
  const preview = await verifyPreviewUrl(runtime, templateName);
  const verification = await verifyContainer(groupId, templateName);
  const result = { chat, groupId, preview, runtime, templateName, verification };
  results.push(result);
  console.log(JSON.stringify({
    groupId,
    templateName,
    runtime,
    preview,
    container: verification.container,
    devPort: verification.status.devPort,
    buildOk: verification.build.ok,
    assistantChars: chat.assistantChars,
    toolEvents: chat.toolEvents,
  }, null, 2));
}

console.log('\nOPENWORK_RUNTIME_API_VERIFY_JSON_START');
console.log(JSON.stringify(results, null, 2));
console.log('OPENWORK_RUNTIME_API_VERIFY_JSON_END');
