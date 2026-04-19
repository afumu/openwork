# 当前系统状态

## 主流程

```text
chat 前端
  -> service /api/openwork/*
     -> 鉴权、计费/额度、日志、群组状态
     -> PI runtime /v1/chat/completions
        -> 智能体会话 / 直连模型路径 / discussion
        -> 宿主再桥接回 service
           -> 模型代理
           -> 搜索桥接
```

## 当前事实

### 1. `service` 仍然是产品网关

前端不会直接调用 PI runtime。`service` 负责：

- 鉴权与用户状态
- 用量、计费或额度
- 聊天日志与群组状态
- 运行时分发
- 内部模型代理
- 内部搜索桥接

### 2. 搜索是平台级的通用搜索能力

OpenWork 向运行时暴露统一的 `web_search` 能力。搜索路由与供应商选择仍由 `service` 负责。

### 3. 运行时保持通用

运行时保留以下职责：

- 会话复用
- 工作区隔离
- 工具权限控制
- 制品列表与读取
- `discussion` 运行时
- Web 搜索工具

它不会内置任何产品专属工作流。

### 4. 运行时容器按用户隔离

当 `PI_DOCKER_ENABLED=1` 时，`service` 会启动或复用带独立工作区的 `openwork-user-<userId>` 容器。

### 5. 运行时打包产物仍然是部署单元

运行时发布版本的事实来源，仍然是已发布的打包产物目录以及 `current.txt`。
