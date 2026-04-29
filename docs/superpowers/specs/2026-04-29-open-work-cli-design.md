# Open Work CLI 设计

## 背景

当前 OpenWork 已按 `service -> OpenSandbox -> openwork-agent-bridge -> Claude Code` 方向接入运行时容器。对话 workspace 通过 OpenSandbox volume 挂载到 `/workspace`，并按 `userId + groupId` 稳定复用。

现有缺口是新 workspace 没有标准项目模板。Claude Code 可以写代码，但从空目录开始创建项目时缺少统一的项目骨架、依赖、启动脚本、构建脚本和 agent 上下文说明。

参考 `/Users/apple/Downloads/coze-cli-source` 后，Open Work v1 采用容器内置模板方案：模板随 CLI 和 runtime 镜像一起打包，初始化时不通过网络访问 service 或外部模板仓库。

## 目标

- 在 sandbox 容器内提供 `openwork` 命令行工具。
- 让 Claude Code 可以根据用户意图调用 `openwork` 初始化项目。
- 模板内置在 CLI 包中，初始化时直接复制和渲染到 `/workspace`。
- 使用统一项目配置驱动 `dev`、`build`、`start`、`status`。
- 模板默认带 `AGENTS.md`，帮助 Claude Code 理解项目结构和开发规范。
- 第一版不做后台模板管理、不做 service 模板下载 API、不做远程模板市场。

## 非目标

- 不让 `service` 直接下载模板或初始化项目。
- 不让容器反向调用 `service` 获取模板。
- 不在第一版实现模板在线更新、版本灰度或管理端配置。
- 不把 Coze CLI 的埋点、patch feature gate、内部 SDK 更新逻辑迁入 Open Work。
- 不在第一版支持移动端和小程序模板，避免 runtime 镜像和排障复杂度过早上升。

## 核心流程

```text
用户发起对话
  -> service 创建或复用 userId + groupId 对应 OpenSandbox
  -> service 通过 bridge 把用户消息交给 Claude Code
  -> Claude Code 识别用户意图
  -> Claude Code 调用 openwork CLI
     openwork init --template vite-vue-admin --install --dev
  -> openwork CLI 从内置模板目录复制并渲染模板到 /workspace
  -> openwork CLI 写入 /workspace/.openwork/project.json
  -> openwork CLI 可选安装依赖并启动 dev 服务
  -> Claude Code 继续修改代码、验证、构建
```

`service` 仍然只做产品网关、鉴权、运行时定位、事件转发和聊天日志记录。项目创建动作发生在容器内。

## 包结构

建议新增独立 CLI 包，后续打进 `openwork-agent-runtime` 镜像。

```text
runtime/openwork-cli/
  package.json
  tsconfig.json
  src/
    main.ts
    commands/
      templates.ts
      init.ts
      dev.ts
      build.ts
      start.ts
      status.ts
    core/
      templateRegistry.ts
      templateConfig.ts
      templateRender.ts
      projectConfig.ts
      workspace.ts
      runCommand.ts
      processManager.ts
      output.ts
  templates/
    templates.json
    native-static/
    vite-react/
    vite-vue/
    vite-vue-admin/
    nextjs/
```

安装到容器后：

```text
/usr/local/bin/openwork
/opt/openwork-cli/templates
```

NPM 包名建议使用 `@openwork/cli`，二进制命令名使用 `openwork`，避免和 `service/package.json` 的 `openwork` 包名混淆。

## 命令设计

### templates

列出内置模板。

```bash
openwork templates
openwork templates --json
```

JSON 输出：

```json
{
  "ok": true,
  "selectionGuide": "Read the user request, choose the closest template from useCases/examples/avoidWhen, and ask a short clarification if the fit is unclear. Do not invent template names.",
  "templates": [
    {
      "name": "vite-vue-admin",
      "title": "Vue 管理后台",
      "description": "适合后台系统、表格、表单、登录和权限页面",
      "useCases": ["admin dashboards", "CRM and operations tools"],
      "avoidWhen": ["public marketing sites", "React-specific requests"],
      "examples": ["用户要一个管理后台、CRM、数据看板或表格系统"],
      "tags": ["vue", "admin", "dashboard"],
      "devPort": 9000
    }
  ]
}
```

### init

初始化项目。

```bash
openwork init [name] --template <name> [--workspace /workspace] [--install] [--dev] [--force] [--json]
```

行为：

1. 解析模板和 workspace。
2. 读取内置 `templates.json`。
3. 校验模板存在。
4. 校验参数并应用默认值。
5. 默认拒绝写入非空 workspace；只有 `--force` 才允许覆盖会冲突的文件。
6. 复制并渲染模板文件。
7. 写入 `.openwork/project.json`。
8. 如果传入 `--install`，执行模板配置的 install 命令。
9. 如果传入 `--dev`，后台启动 dev 服务。

成功 JSON：

```json
{
  "ok": true,
  "action": "init",
  "template": "vite-vue-admin",
  "workspace": "/workspace",
  "projectConfig": "/workspace/.openwork/project.json",
  "installed": true,
  "devStarted": true,
  "port": 9000
}
```

### dev / build / start

生命周期命令只读取 `.openwork/project.json`，不猜项目类型。

```bash
openwork dev [--workspace /workspace] [--log-file path] [--json]
openwork build [--workspace /workspace] [--log-file path] [--json]
openwork start [--workspace /workspace] [--log-file path] [--json]
```

命令映射：

```text
openwork dev   -> project.commands.dev
openwork build -> project.commands.build
openwork start -> project.commands.start
```

`dev` 和 `start` 默认前台运行。`init --dev` 需要后台启动时，由 CLI 的 process manager 封装 detached 启动，并把 pid/status 写入 `.openwork/runtime.json`。

### status

读取项目配置、运行时状态和端口信息。

```bash
openwork status [--workspace /workspace] [--json]
```

输出：

```json
{
  "ok": true,
  "initialized": true,
  "workspace": "/workspace",
  "template": "vite-vue-admin",
  "devPort": 9000,
  "dev": {
    "running": true,
    "pid": 12345
  }
}
```

## 模板结构

每个模板建议使用：

```text
templates/vite-vue-admin/
  template.openwork.json
  AGENTS.md
  _gitignore
  _npmrc
  scripts/
    prepare.sh
    dev.sh
    build.sh
    start.sh
    validate.sh
  package.json
  src/
```

`_gitignore` 和 `_npmrc` 在渲染时转换成 `.gitignore` 和 `.npmrc`。模板配置文件和内部忽略文件不复制到目标项目。

## 模板注册表

`templates/templates.json` 作为总索引。

```json
{
  "schemaVersion": 1,
  "templates": [
    {
      "name": "vite-vue-admin",
      "title": "Vue 管理后台",
      "description": "适合后台系统、表格、表单、登录和权限页面",
      "location": "./vite-vue-admin",
      "tags": ["vue", "admin", "dashboard"],
      "devPort": 9000
    }
  ]
}
```

每个模板的 `template.openwork.json` 定义参数和生命周期命令。

```json
{
  "schemaVersion": 1,
  "name": "vite-vue-admin",
  "paramsSchema": {
    "type": "object",
    "properties": {
      "appName": {
        "type": "string",
        "default": "openwork-app",
        "pattern": "^[a-z0-9-]+$"
      },
      "port": {
        "type": "number",
        "default": 9000,
        "minimum": 1024,
        "maximum": 65535
      }
    },
    "additionalProperties": false
  },
  "commands": {
    "install": ["pnpm", "install", "--prefer-frozen-lockfile", "--prefer-offline"],
    "dev": ["bash", "./scripts/dev.sh"],
    "build": ["bash", "./scripts/build.sh"],
    "start": ["bash", "./scripts/start.sh"],
    "validate": ["bash", "./scripts/validate.sh"]
  }
}
```

第一版尽量使用 JSON 配置，不使用 JS hook。这样模板能力更弱一点，但更稳定、更容易审查和打包。

## 项目配置

初始化后生成 `/workspace/.openwork/project.json`。

```json
{
  "schemaVersion": 1,
  "name": "openwork-app",
  "template": "vite-vue-admin",
  "createdAt": "2026-04-29T00:00:00.000Z",
  "workspace": "/workspace",
  "devPort": 9000,
  "commands": {
    "install": ["pnpm", "install", "--prefer-frozen-lockfile", "--prefer-offline"],
    "dev": ["bash", "./scripts/dev.sh"],
    "build": ["bash", "./scripts/build.sh"],
    "start": ["bash", "./scripts/start.sh"],
    "validate": ["bash", "./scripts/validate.sh"]
  }
}
```

`.openwork/runtime.json` 记录后台 dev/start 进程。

```json
{
  "dev": {
    "pid": 12345,
    "startedAt": "2026-04-29T00:00:00.000Z",
    "port": 9000,
    "logFile": "/workspace/.openwork/logs/dev.log"
  }
}
```

## 模板渲染

借鉴 Coze CLI 的渲染流程：

- 文本文件用 EJS 渲染。
- 二进制文件直接复制。
- `_gitignore` 转 `.gitignore`。
- `_npmrc` 转 `.npmrc`。
- `template.openwork.json`、`template.config.js`、`template.config.ts`、`.DS_Store` 不复制。
- 默认忽略 `node_modules`，依赖通过镜像缓存和 `pnpm install --prefer-offline` 恢复。

模板上下文：

```json
{
  "appName": "openwork-app",
  "packageName": "openwork-app",
  "port": 9000,
  "devPort": 9000
}
```

## 内置模板

第一版内置：

```text
native-static
vite-react
vite-vue
vite-vue-admin
nextjs
```

暂缓：

```text
nuxt-vue
taro
expo
```

暂缓原因：这些模板依赖更重、端口和构建链路更复杂，会增加第一版 runtime 镜像和排障成本。

## Claude Code 使用约定

runtime 镜像中提供全局说明文件，例如 `/opt/openwork-cli/AGENTS.md`：

```text
When creating a new app in an empty workspace:
1. Run `openwork templates --json`.
2. Read the template descriptions and choose the closest template based on the user request.
3. Use `useCases`, `avoidWhen`, and `examples` to choose. If the template choice is unclear, ask the user a short clarification instead of guessing through CLI rules.
4. Run `openwork init --template <name> --install --dev`.
5. Continue editing files under `/workspace`.
6. Run `openwork build` or template validate command before reporting completion.
```

每个模板自身也带 `AGENTS.md`，初始化后复制到项目根目录。

## 错误处理

所有命令支持 `--json` 输出稳定错误结构。

```json
{
  "ok": false,
  "code": "WORKSPACE_NOT_EMPTY",
  "message": "Workspace is not empty. Use --force to overwrite conflicting files."
}
```

错误码：

```text
TEMPLATE_NOT_FOUND
TEMPLATE_CONFIG_INVALID
PARAM_VALIDATION_FAILED
WORKSPACE_NOT_EMPTY
FILE_CONFLICT
PROJECT_CONFIG_NOT_FOUND
COMMAND_NOT_CONFIGURED
COMMAND_FAILED
PORT_IN_USE
PROCESS_NOT_FOUND
```

## 从 Coze CLI 借鉴的机制

- CLI 使用 commander 注册命令。
- 模板放在 CLI 包内，随包发布。
- `templates.json` 作为模板索引。
- 模板参数用 JSON Schema 校验。
- 文本文件使用 EJS 渲染。
- `_gitignore`、`_npmrc` 转换为点文件。
- `dev/build/start` 通过项目配置代理到模板脚本。
- 模板内置 `AGENTS.md`，帮助 agent 理解项目。

## 不照搬的机制

- 不默认 `force = true`。Open Work 默认保护已有 workspace。
- 不迁入 Slardar 埋点。
- 不迁入 patch feature gate。
- 不迁入 Coze 内部 SDK 后台更新逻辑。
- 不在运行时对模板目录执行 `pnpm install` 作为常规 warmup；模板依赖预热放到镜像构建阶段。
- 不支持多配置格式；第一版只使用 JSON。

## 镜像集成

`openwork-agent-runtime` 镜像构建时：

1. 构建 `@openwork/cli`。
2. 复制 CLI dist 和 templates 到 `/opt/openwork-cli`。
3. 链接 `/usr/local/bin/openwork`。
4. 预装 Node.js、pnpm、Python、git、rg 等基础工具。
5. 可选执行模板依赖预热，把 pnpm store 缓存在镜像层。
6. 在 `/opt/openwork-cli/AGENTS.md` 写入 Claude Code 使用约定。

## 验收标准

- `openwork templates --json` 能列出内置模板。
- `openwork templates --json` 输出模型可读的 `selectionGuide`、`useCases`、`avoidWhen` 和 `examples`。
- 空 `/workspace` 下执行 `openwork init --template native-static --json` 会生成项目和 `.openwork/project.json`。
- 非空 `/workspace` 下不带 `--force` 执行 init 会失败并返回 `WORKSPACE_NOT_EMPTY` 或 `FILE_CONFLICT`。
- `openwork dev/build/start` 能读取 `.openwork/project.json` 并执行对应命令。
- 模板生成后的项目根目录包含 `AGENTS.md`。
- Claude Code 能通过 Bash 调用 `openwork init --template <name> --install --dev` 完成项目初始化。

## 实施顺序

1. 新增 `runtime/openwork-cli` 包骨架和命令入口。
2. 实现模板 registry、JSON Schema 参数校验、JSON 输出。
3. 实现模板复制、EJS 渲染、点文件转换和冲突检测。
4. 实现 `.openwork/project.json` 生成与读取。
5. 实现 `dev/build/start/status`。
6. 增加 `native-static` 和一个 Vite 模板作为第一批测试模板。
7. 增加 `vite-vue-admin`、`vite-react`、`nextjs`。
8. 更新 runtime 镜像构建，把 CLI 和模板打入容器。
9. 更新 docs/current 文档，说明项目初始化由 `openwork` CLI 负责。
