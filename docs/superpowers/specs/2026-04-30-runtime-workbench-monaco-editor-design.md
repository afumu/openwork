# Runtime 工作台 Monaco 编辑器设计

## 目标

把 chat 项目右侧 runtime 工作台从“只读文件查看器”升级为一个可实际编码的 Web IDE 工作区。

第一版保持 OpenWork 原生体验，而不是把另一个独立 IDE 嵌进产品里。它继续保留当前聊天、预览、运行时状态和 OpenSandbox 终端体验，同时围绕 Monaco Editor 补齐基础编辑器工作流。

## 当前状态

当前实现已经完成第一阶段的可编辑工作台主链路：

- `RuntimeWorkspacePanel.vue` 负责整体布局、runtime status/list/read、文件标签集成、保存、创建、重命名、删除、刷新/重新加载和冲突提示，并保留 preview/terminal 分栏。
- `RuntimeCodeEditor.vue` 是 Monaco wrapper，不再是 CodeMirror 查看器；它按 `runtime://workspace/{path}` 维护 Monaco model，支持 `Cmd/Ctrl+S` 触发保存，并展示标签、dirty、conflict、saving 等状态。
- `RuntimeFileExplorer.vue` 渲染工作区文件树，并发出 `refresh`、`create-file`、`rename-selected`、`delete-selected`、`select-file` 事件。
- `useRuntimeWorkspaceTabs.ts` 管理 `baseUpdatedAt`、`content`、`savedContent`、`dirty`、`saving`、`conflict` 等标签状态。干净标签遇到外部更新会重新加载，dirty 标签遇到外部更新会标记冲突，被删除的干净标签会关闭。
- `RuntimePreviewPane.vue` 继续支持应用预览、Markdown、HTML、图片和文本预览。
- `RuntimeTerminalPane.vue` 继续用 xterm 连接 OpenSandbox PTY WebSocket。
- 前端已添加 `monaco-editor` 依赖。

后端工作区接口也已经从只读扩展为可编辑：list/read/write/create/rename/delete/search/status/terminal。service 层继续负责鉴权、用户和 group 对应 sandbox 的定位、路径归一化以及代理转发。前端不能直接拿到 OpenSandbox endpoint。

常用部署下前端会通过 `/api` 前缀访问 service，业务路由本身在 `/openwork/runtime/workspace` 下。

## 选型结论

用 Monaco Editor 作为编辑器内核，继续保留 OpenWork 自己的工作台外壳。

这样可以获得接近 VS Code 的编辑体验，包括多光标、搜索、选择、minimap、快捷键、diff 能力和后续语言服务接入路径，同时避免每个 sandbox 都运行完整 code-server 或 OpenVSCode 带来的运维成本。

CodeMirror 仍然可以保留在 `HtmlDialog.vue` 这类小型弹窗里使用；runtime 工作台已经迁移到 Monaco，因为这个区域的产品预期已经不再是“看文件”，而是“处理一个真实项目”。

## 备选方案

### 继续使用 CodeMirror 6

优点：

- 仓库里已经安装。
- 包体小，Vue 集成简单。
- MIT 许可，可扩展性不错。

缺点：

- 需要自行补齐大量 IDE 行为。
- LSP、诊断、多文件模型管理、VS Code 风格交互都不如 Monaco 直接。

CodeMirror 不再是 runtime 工作台方向。

### 嵌入 code-server 或 OpenVSCode Server

优点：

- 最接近完整 VS Code 体验。
- 文件管理、搜索、设置、终端、扩展、Git UI 都比较完整。

缺点：

- 会在 OpenWork 产品外壳里再套一个 IDE 外壳。
- 需要处理每个 sandbox 的 IDE 进程管理、路由、鉴权、资源限制和生命周期清理。
- 扩展市场行为和 Microsoft 官方 VS Code 不完全一致。
- 更难和 OpenWork 自己的聊天、agent、预览、部署、计费流程深度整合。

建议把它保留为后续“在完整 IDE 中打开”的高级模式，而不是默认嵌入工作台。

### 采用 Eclipse Theia

优点：

- 成熟的开源云 IDE 框架。
- 适合做白标 IDE 产品或领域专用开发工具。

缺点：

- 对当前目标来说太重。
- 会把项目方向推向“另建一个 IDE 平台”，而不是增强 chat 右侧工作台。

第一版不采用 Theia。

## 产品范围

### 第一阶段：已实现的可编辑 Monaco 工作台

当前第一阶段已经覆盖：

- 用 Monaco 替换 runtime 工作台里的 CodeMirror 文件查看能力，入口仍是 `RuntimeCodeEditor.vue`。
- 支持多个已打开文件标签。
- 每个标签维护未保存状态。
- 支持保存按钮和 `Cmd/Ctrl+S`。
- runtime 文件变化后支持刷新、重新加载和冲突提示。
- 通过 OpenWork service API 支持文件创建、更新、重命名、删除、搜索。
- 路径安全：前端只传工作区相对路径，后端统一归一化，不能逃逸 workspace。
- 隐藏/拒绝所有 `.openwork` 路径。
- 继续使用现有 `RuntimePreviewPane.vue` 做应用和文件预览。
- 继续使用现有 `RuntimeTerminalPane.vue` 做终端。

### 非第一阶段能力 / 后续工作

以下能力不要当作当前已完成能力记录：

- VS Code 扩展。
- 完整 Git UI。
- Debugger。
- 多人协作编辑。
- 完整语言服务器集成。
- diff 视图。
- 自动保存。
- 文件树右键菜单。
- 更完整的编辑器/预览并排布局。
- include/exclude 搜索过滤实际生效。
- 后端基于 `baseUpdatedAt` 的强 optimistic concurrency 校验。

### 第二阶段：IDE 工作流打磨

编辑和写入链路稳定后再补：

- 外部变更或 agent 修改文件后的 diff 视图。
- 更好的文件图标和空状态。
- 文件树右键菜单。
- 重命名、创建、删除交互打磨。
- 可选自动保存设置。
- 如果布局空间允许，支持编辑器和预览并排。
- 让 search 的 include/exclude globs 在后端真正生效。
- 让 `baseUpdatedAt` 在后端参与 optimistic concurrency 冲突检测。

### 第三阶段：语言智能

语言能力按优先级逐步接：

- 优先启用 Monaco 内置 TypeScript/JavaScript 能力。
- 之后补 JSON/CSS/HTML 诊断。
- 再按需要通过 `monaco-languageclient` 接 Python 或其他 LSP。
- 语言服务器应运行在 sandbox 内，或运行在受控的 service 侧进程里，并通过带鉴权的 service WebSocket 连接到前端。

## 架构设计

### 前端组件

当前组件边界：

- `RuntimeWorkspacePanel.vue`
  - 负责高层布局和 runtime 状态。
  - 负责当前工作台模式：编辑器、预览、终端、信息面板。
  - 集成文件 list/read/status、tabs、保存、创建、重命名、删除、刷新、重新加载和冲突处理。
  - 保持 preview/terminal 不被编辑器改造破坏。

- `RuntimeCodeEditor.vue`
  - 封装 Monaco 生命周期。
  - 以 `runtime://workspace/{path}` 为每个打开文件创建/复用 Monaco model。
  - 接收当前激活标签、dirty、saving、conflict 等状态。
  - 发出内容变化、保存命令、关闭/切换标签等事件。

- `RuntimeFileExplorer.vue`
  - 渲染文件树。
  - 发出刷新、创建文件、重命名、删除、选择文件事件。

- `useRuntimeWorkspaceTabs.ts`
  - 管理已打开标签、当前激活路径、已加载文件元数据、`baseUpdatedAt`、未保存状态、保存中状态和冲突状态。
  - 干净外部更新：重新加载内容。
  - dirty 外部更新：标记 conflict。
  - 干净标签对应文件被删除：关闭标签。

还没有独立的 `RuntimeMonacoEditor.vue`、`RuntimeEditorTabs.vue` 或 `useRuntimeWorkspaceFiles.ts`。后续如果 `RuntimeWorkspacePanel.vue` 继续膨胀，可以再按真实边界拆分。

### 后端 API

service 已提供工作区 API。常见部署会加 `/api` 前缀，下面列业务路由：

- `POST /openwork/runtime/workspace/list`
- `POST /openwork/runtime/workspace/read`
- `POST /openwork/runtime/workspace/write`
  - 入参：`{ groupId, path, content, baseUpdatedAt? }`
  - 返回：`{ kind, name, path, size, type, updatedAt, runId, source }`
  - `baseUpdatedAt` 已由前端传入并被 DTO 接收，但后端当前不强制 optimistic concurrency；冲突处理主要来自前端轮询和标签状态。

- `POST /openwork/runtime/workspace/create`
  - 入参：`{ groupId, path, content?, kind? }`
  - 返回 entry metadata。

- `POST /openwork/runtime/workspace/rename`
  - 入参：`{ groupId, fromPath, toPath }`
  - 返回：`{ fromPath, toPath, entry }`

- `POST /openwork/runtime/workspace/delete`
  - 入参：`{ groupId, path }`
  - 返回：`{ deleted: true, path, kind, size, type, updatedAt }`

- `POST /openwork/runtime/workspace/search`
  - 入参：`{ groupId, query, include?, exclude? }`
  - 返回：`{ results: [{ path, matches: [{ line, column, preview }] }], truncated }`
  - `include`/`exclude` 已在 DTO/client 中保留，但后端当前忽略，不能文档化为已生效过滤能力。

- `POST /openwork/runtime/status`
- `WS /openwork/runtime/terminal`

API client 已导出 typed status/list/read/write/create/rename/delete/search wrappers。`executeRuntimeCommandAPI` 仍指向 `/openwork/runtime/exec`，但当前没有匹配 controller endpoint，不应把它记录为可用 runtime API。

每个 workspace 接口都必须：

- 要求 JWT 鉴权。
- 校验 group 是项目组。
- 通过 OpenSandbox runtime service 定位当前用户和 group 对应的 sandbox。
- 基于配置的 workspace root 做路径归一化和校验。
- 拒绝路径穿越、workspace 外绝对路径、过大 payload 和二进制编辑。
- 隐藏/拒绝 `.openwork` 下的路径。
- 通过现有响应风格返回本地化、用户可理解的错误。

### OpenSandbox 文件操作和限制

runtime service 通过在 sandbox 内执行有边界的 Node 脚本实现 workspace 操作。文件操作应使用 sandbox 内的 Node filesystem API，不要用 shell 字符串拼接做文件操作。命令参数继续单独传入，并沿用现有 shell quote 辅助函数。

当前限制：

- list 最多 2000 个文件。
- read 最大 1 MiB。
- 可编辑/search 文件最大 1 MiB。
- write payload 最大 2 MiB。
- search 最多扫描 200 个文件，最多返回 1000 条匹配。
- 二进制文件第一阶段只支持预览或下载，不支持编辑。
- `.openwork` 路径隐藏且被 workspace API 拒绝。

## 数据流

### 打开文件

1. 用户在文件树中选择文件。
2. 前端如果已有对应标签，则直接切换到该标签。
3. 如果没有标签，则调用 `workspace/read`。
4. `RuntimeCodeEditor.vue` 为路径创建或复用 `runtime://workspace/{path}` Monaco model。
5. 如果文件不是二进制、未超限且未截断，标签进入可编辑状态。

### 保存文件

1. 用户按 `Cmd/Ctrl+S` 或点击保存。
2. 前端携带当前内容和 `baseUpdatedAt` 调用 `workspace/write`。
3. 后端校验路径并写入 sandbox workspace。
4. 后端返回新的 `updatedAt`、size、type 和 path。
5. 前端清除该标签未保存状态，并刷新 manifest。
6. 如果当前文件正在预览，刷新 iframe 或 Markdown 预览。

注意：`baseUpdatedAt` 当前只是被传递和接收，后端不基于它阻止写入。现有冲突体验来自前端轮询发现外部更新后标记 dirty 标签为 conflict。

### 外部变更

agent 或终端命令可能在用户打开文件时修改同一个文件。

轮询发现打开中的干净标签有更新时，前端重新加载内容。轮询发现打开中的未保存标签有更新时，进入冲突状态，并提供保留当前修改或从工作区重新加载的处理。diff 视图属于后续工作。

## 交互规则

- 工作台视觉上继续融入 chat 页面。
- 编辑器、预览和终端继续通过分栏保持可见。
- 保存状态要明确但克制：未保存圆点、保存中状态、冲突标签即可。
- 删除、覆盖、重命名这类破坏性操作需要确认或清晰提示。
- 没有 runtime 时，界面应展示清晰空状态并允许用户刷新。
- 除非用户打开信息面板，否则不要暴露原始 OpenSandbox endpoint 或内部 sandbox 元数据。

## 错误处理

需要明确处理这些情况：

- runtime 尚未创建。
- 工作区 list/read/write/create/rename/delete/search 命令失败。
- 打开的文件被删除。
- 文件在编辑器外发生变化。
- 文件过大或是二进制。
- 路径非法、逃逸 workspace 或命中 `.openwork` 隐藏路径。
- sandbox 已停止或过期。

前端错误沿用当前 toolbar/error strip 风格展示；适合重试的场景提供重试入口。

## 测试状态

已知验证结果：

- service runtime workspace spec passed。
- chat tests passed。
- chat type-check 仍有既存的无关项目错误；过滤检查未发现本次 workspace component 相关错误。

后续仍应覆盖：

- 标签状态和未保存状态转换。
- 保存命令调用正确 API。
- 外部更新干净标签时刷新内容。
- 外部更新未保存标签时进入冲突状态。
- 文件树操作正确发出 create/rename/delete 事件。
- write/create/rename/delete/search 的 service 测试。
- 拒绝路径穿越、`.openwork` 路径和过大 payload。

## 当前 API 参考

当前接口和安全规则的 source of truth 见：`docs/current/runtime-workspace-api.md`。

## 参考资料

- Monaco Editor: https://github.com/microsoft/monaco-editor
- CodeMirror: https://codemirror.net/
- monaco-languageclient: https://github.com/TypeFox/monaco-languageclient
- monaco-vscode-api: https://github.com/CodinGame/monaco-vscode-api
- code-server: https://github.com/coder/code-server
- OpenVSCode Server: https://github.com/gitpod-io/openvscode-server
- Eclipse Theia: https://projects.eclipse.org/projects/ecd.theia
