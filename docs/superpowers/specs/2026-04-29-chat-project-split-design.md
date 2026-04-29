# 对话与项目模式拆分设计

## 背景

当前用户进入对话后，前端会在任意 active group 下展示 workspace，后端也会按模型配置决定是否走 OpenSandbox agent。结果是普通问答和项目工作流混在一起，用户只是聊天时也会被带入容器、文件、预览、终端这一套项目心智。

目标是把普通聊天和项目工作拆开：普通聊天保持轻量问答；项目模式才创建和复用 OpenSandbox runtime，并展示项目工作区。

## 产品结构

入口保留一个主输入框，但在输入框顶部增加两个模式 tab：

- `普通对话`：默认模式。用户发送后创建普通对话 group，进入纯聊天页面。
- `项目`：用户切换后发送需求，创建项目 group，进入项目页面。

左侧侧边栏分成两个历史区：

- `对话记录`：展示普通对话。
- `项目`：展示项目记录。

用户点击任意记录时继续对应模式。普通对话进入聊天页；项目进入项目页。置顶、重命名、删除继续复用现有 group 操作。

## 数据模型

在 `chat_group` 增加模式字段：

```ts
groupType: 'chat' | 'project'
```

默认值为 `chat`。现有历史数据没有该字段时按 `chat` 处理，避免迁移后老记录误进入项目工作流。

`/group/create` 增加可选参数 `groupType`。前端创建普通对话时传 `chat`，创建项目时传 `project`。`/group/query` 返回该字段，前端据此分区展示。

## 前端设计

`chat/` 继续作为用户侧主入口，但视图语义拆成两种：

- 普通对话视图：全宽聊天，不展示 `RuntimeWorkspacePanel`、项目文件入口和终端相关 UI。
- 项目视图：左侧聊天，右侧 `RuntimeWorkspacePanel`，保留文件、预览、终端与 artifact 入口。

推荐路由形态：

```text
/chat/:groupId?
/project/:groupId?
```

如果当前仍然使用单页入口，也可以先通过 store 中的 active groupType 控制布局，路由作为第二步补齐。首版实现以数据边界为准：只有 active group 是 `project` 时，才渲染项目 workspace。

## 后端设计

`ChatService.chatProcess` 在决定调用 OpenSandbox agent 前读取 group 信息：

- `groupType === 'project'`：允许按现有 OpenSandbox agent 逻辑运行。
- `groupType !== 'project'`：强制走普通模型对话通道。

runtime 状态、workspace 文件、终端等接口也以 groupType 做保护。普通对话访问这些能力时返回空状态或明确的不可用提示，不隐式创建容器。

## 数据流

普通对话：

```text
选择普通对话 tab
  -> 发送首条消息
  -> /group/create { groupType: 'chat' }
  -> /chat/process 普通模型通道
  -> 侧边栏进入「对话记录」
```

项目：

```text
选择项目 tab
  -> 发送项目需求
  -> /group/create { groupType: 'project' }
  -> /chat/process OpenSandbox agent 通道
  -> 创建或复用 userId + groupId runtime
  -> 侧边栏进入「项目」
```

## 边界与兼容

- 老 group 默认归为普通对话。
- 应用 appId 对话首版仍归普通对话，除非创建入口明确选择项目。
- 文件上传跟随当前模式：普通对话保留模型支持的附件能力；项目模式额外展示 workspace/artifact 入口。
- 移动端首版不强制展示 workspace，项目记录仍可进入项目对话，后续再补移动 workspace 抽屉体验。

## 错误处理

- 创建项目 group 失败时，不发送首条消息，并提示用户重试。
- 项目 runtime 不可用时，保留聊天记录创建，但 assistant 返回明确错误，不降级为普通问答，以免用户误以为项目已执行。
- 普通对话误点 runtime 接口时，后端返回不可用状态，前端不展示 workspace。

## 测试计划

- 后端：覆盖 groupType 默认值、创建参数、查询返回、普通对话不触发 OpenSandbox、项目对话触发 OpenSandbox。
- 前端 store：覆盖 `queryMyGroup` 映射 groupType，普通/项目创建参数正确。
- 前端组件：覆盖侧边栏按 groupType 分区，`RuntimeWorkspacePanel` 只在项目 group 显示。
- 手动验证：普通聊天首条消息不创建容器；项目首条消息进入项目布局并创建或复用 runtime。

