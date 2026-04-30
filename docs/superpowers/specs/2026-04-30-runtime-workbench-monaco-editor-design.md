# Runtime 工作台 Monaco 编辑器设计

## 目标

把 chat 项目右侧 runtime 工作台从“只读文件查看器”升级为一个可实际编码的 Web IDE 工作区。

第一版应该保持 OpenWork 原生体验，而不是把另一个独立 IDE 嵌进产品里。它需要保留当前聊天、预览、运行时状态和 OpenSandbox 终端体验，同时围绕 Monaco Editor 补齐完整编辑器工作流。

## 当前状态

chat 工作台已经有了比较合适的外层结构：

- `RuntimeWorkspacePanel.vue` 负责文件树、编辑/预览页签、运行时状态和终端分栏。
- `RuntimeFileExplorer.vue` 从 `runtime/workspace/list` 渲染工作区文件。
- `RuntimeCodeEditor.vue` 目前用 CodeMirror 6 做只读、单文件代码查看。
- `RuntimePreviewPane.vue` 支持应用预览、Markdown、HTML、图片和文本预览。
- `RuntimeTerminalPane.vue` 用 xterm 连接 OpenSandbox PTY WebSocket。

后端目前只提供只读工作区接口：

- `POST /api/openwork/runtime/workspace/list`
- `POST /api/openwork/runtime/workspace/read`
- `POST /api/openwork/runtime/status`
- `WS /api/openwork/runtime/terminal`

OpenSandbox 是当前运行时方向。`service` 层必须继续负责鉴权、用户和 group 对应 sandbox 的定位、路径归一化以及代理转发。前端不能直接拿到 OpenSandbox endpoint。

## 选型结论

用 Monaco Editor 作为编辑器内核，继续保留 OpenWork 自己的工作台外壳。

这样可以获得接近 VS Code 的编辑体验，包括多光标、搜索、选择、minimap、快捷键、diff 能力和后续语言服务接入路径，同时避免每个 sandbox 都运行完整 code-server 或 OpenVSCode 带来的运维成本。

CodeMirror 仍然可以保留在 `HtmlDialog.vue` 这类小型弹窗里使用，但 runtime 工作台应该迁移到 Monaco，因为这个区域的产品预期已经不再是“看文件”，而是“处理一个真实项目”。

## 备选方案

### 继续使用 CodeMirror 6

优点：

- 仓库里已经安装。
- 包体小，Vue 集成简单。
- MIT 许可，可扩展性不错。

缺点：

- 当前实现是只读的，而且每次文件或内容变化都会重建编辑器。
- 要做成完整 IDE 体验，需要自己补很多工作。
- LSP、诊断、多文件模型管理、VS Code 风格交互都不如 Monaco 直接。

只有当包体大小成为最高优先级时，才考虑继续沿用 CodeMirror。

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

### 第一阶段：可编辑 Monaco 工作台

第一版需要交付：

- 用 Monaco 编辑器替换 `RuntimeCodeEditor.vue`。
- 支持多个已打开文件标签。
- 每个标签维护未保存状态。
- 支持工具栏保存按钮和 `Cmd/Ctrl+S`。
- runtime 文件变化后支持刷新或重新加载。
- 通过 OpenWork service API 支持文件创建、更新、重命名、删除。
- 路径安全：前端只传工作区相对路径，后端统一归一化，不能逃逸 `/workspace`。
- 继续使用现有 `RuntimePreviewPane.vue` 做应用和文件预览。
- 继续使用现有 `RuntimeTerminalPane.vue` 做终端。

第一阶段不做：

- VS Code 扩展。
- 完整 Git UI。
- Debugger。
- 多人协作编辑。
- 完整语言服务器集成。

### 第二阶段：IDE 工作流打磨

编辑和写入链路稳定后再补：

- 工作区全文搜索。
- 外部变更或 agent 修改文件后的 diff 视图。
- 更好的文件图标和空状态。
- 文件树右键菜单。
- 重命名、创建、删除确认。
- 可选自动保存设置。
- 如果布局空间允许，支持编辑器和预览并排。

### 第三阶段：语言智能

语言能力按优先级逐步接：

- 优先启用 Monaco 内置 TypeScript/JavaScript 能力。
- 之后补 JSON/CSS/HTML 诊断。
- 再按需要通过 `monaco-languageclient` 接 Python 或其他 LSP。
- 语言服务器应运行在 sandbox 内，或运行在受控的 service 侧进程里，并通过带鉴权的 service WebSocket 连接到前端。

## 架构设计

### 前端组件

需要把编辑器边界拆清楚：

- `RuntimeWorkspacePanel.vue`
  - 负责高层布局和 runtime 轮询。
  - 负责当前工作台模式：编辑器、预览、终端、信息面板。
  - 把文件标签状态交给 composable 管理。

- `RuntimeMonacoEditor.vue`
  - 封装 Monaco 生命周期。
  - 接收当前激活标签、只读状态、未保存状态和保存中状态。
  - 发出内容变化、保存命令和编辑器 ready 事件。

- `RuntimeEditorTabs.vue`
  - 展示已打开文件。
  - 标记未保存状态。
  - 支持关闭和切换标签。

- `RuntimeFileExplorer.vue`
  - 保留当前文件树渲染。
  - 增加创建、重命名、删除事件。

- `useRuntimeWorkspaceTabs.ts`
  - 管理已打开标签、当前激活路径、已加载文件元数据、未保存状态和冲突状态。

- `useRuntimeWorkspaceFiles.ts`
  - 封装 list/read/write/create/delete/search API 调用和路径归一化辅助逻辑。

随着工作台能力变多，`RuntimeWorkspacePanel.vue` 不应该继续膨胀成大控制器。编辑状态和文件操作逻辑要逐步移动到 composable 里。

### 后端 API

新增由 service 负责鉴权和转发的接口：

- `POST /api/openwork/runtime/workspace/write`
  - 入参：`groupId`、`path`、`content`，可选 `baseUpdatedAt`。
  - 写入 UTF-8 文本文件。
  - 返回更新后的文件元数据；如果基准版本过旧，返回冲突信息。

- `POST /api/openwork/runtime/workspace/create`
  - 入参：`groupId`、`path`，可选 `content`、`kind`。
  - 创建文件或目录。

- `POST /api/openwork/runtime/workspace/rename`
  - 入参：`groupId`、`fromPath`、`toPath`。

- `POST /api/openwork/runtime/workspace/delete`
  - 入参：`groupId`、`path`。

- `POST /api/openwork/runtime/workspace/search`
  - 入参：`groupId`、`query`，可选 include/exclude globs。
  - 返回有上限的搜索结果和截断信息。

每个接口都必须：

- 要求 JWT 鉴权。
- 校验 group 是项目组。
- 通过 OpenSandbox runtime service 定位当前用户和 group 对应的 sandbox。
- 基于配置的 workspace root 做路径归一化和校验。
- 拒绝路径穿越、workspace 外绝对路径、过大 payload 和二进制写入。
- 通过现有响应风格返回本地化、用户可理解的错误。

### OpenSandbox 文件操作

现有 runtime service 已经通过在 sandbox 内执行有边界的 Node 脚本来实现 list/read。write/create/rename/delete/search 也沿用这个模式。

文件操作应使用 sandbox 内的 Node filesystem API，不要用 shell 字符串拼接做文件操作。命令参数继续单独传入，并沿用现有 shell quote 辅助函数。

建议限制：

- 第一阶段可编辑文本文件最大 1 MB。
- 单次写入 payload 最大 2 MB。
- 文件列表继续沿用当前有上限的行为。
- 搜索最多返回 200 个文件或 1000 条行匹配，以先达到者为准。

二进制文件第一阶段只支持预览或下载，不支持编辑。

## 数据流

### 打开文件

1. 用户在文件树中选择文件。
2. 前端如果已有对应标签，则直接切换到该标签。
3. 如果没有标签，则调用 `workspace/read`。
4. `useRuntimeWorkspaceTabs` 根据路径创建 Monaco model。
5. 如果文件不是二进制、未超限且未截断，标签进入可编辑状态。

### 保存文件

1. 用户按 `Cmd/Ctrl+S` 或点击保存。
2. 前端携带当前内容和 `baseUpdatedAt` 调用 `workspace/write`。
3. 后端校验路径并写入 sandbox workspace。
4. 后端返回新的 `updatedAt`、size、type 和 path。
5. 前端清除该标签未保存状态，并刷新 manifest。
6. 如果当前文件正在预览，刷新 iframe 或 Markdown 预览。

### 外部变更

agent 或终端命令可能在用户打开文件时修改同一个文件。

轮询发现打开中的干净标签有更新时，前端可以静默刷新内容。轮询发现打开中的未保存标签有更新时，进入冲突状态，并提供操作：

- 保留我的修改。
- 从工作区重新加载。
- 查看 diff。

第一阶段可以先做“保留/重新加载”，diff 放到第二阶段。

## 交互规则

- 工作台视觉上继续融入 chat 页面。
- 编辑器、预览和终端继续通过分栏保持可见。
- 保存状态要明确但克制：未保存圆点、保存中状态、已保存时间或短暂 toolbar 提示即可。
- 删除、覆盖、重命名这类破坏性操作必须确认。
- 没有 runtime 时，界面应展示清晰空状态并允许用户刷新。
- 除非用户打开信息面板，否则不要暴露原始 OpenSandbox endpoint 或内部 sandbox 元数据。

## 错误处理

需要明确处理这些情况：

- runtime 尚未创建。
- 工作区 list/read/write 命令失败。
- 打开的文件被删除。
- 文件在编辑器外发生变化。
- 文件过大或是二进制。
- 路径非法或逃逸 workspace。
- sandbox 已停止或过期。

前端错误沿用当前 toolbar/error strip 风格展示；适合重试的场景提供重试入口。

## 测试

### 前端

补充聚焦测试：

- 标签状态和未保存状态转换。
- 保存命令调用正确 API。
- 外部更新干净标签时刷新内容。
- 外部更新未保存标签时进入冲突状态。
- 文件树操作正确发出 create/rename/delete 事件。
- 现有 project-mode 测试继续保证只有项目组显示工作台。

### 后端

补充 service/runtime 测试：

- write 创建或更新文件。
- 创建目录和文件。
- rename 和 delete 行为。
- 拒绝路径穿越。
- 拒绝过大 payload。
- runtime 缺失时的行为。
- search 截断行为。

### 手动验证

运行：

- `cd chat && pnpm test`
- `cd chat && pnpm type-check`
- runtime workspace API 相关 service 测试

再在浏览器中验证：

- 打开项目组。
- 打开多个文件。
- 编辑并保存。
- 确认预览更新。
- 创建、重命名、删除文件。
- 用终端修改文件，确认外部变更处理。

## 参考资料

- Monaco Editor: https://github.com/microsoft/monaco-editor
- CodeMirror: https://codemirror.net/
- monaco-languageclient: https://github.com/TypeFox/monaco-languageclient
- monaco-vscode-api: https://github.com/CodinGame/monaco-vscode-api
- code-server: https://github.com/coder/code-server
- OpenVSCode Server: https://github.com/gitpod-io/openvscode-server
- Eclipse Theia: https://projects.eclipse.org/projects/ecd.theia
