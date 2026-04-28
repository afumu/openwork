# OpenWork 开发风格指南

这份文档用于约束后续对 OpenWork 仓库的修改方式。目标不是把所有模块硬拧成一种写法，而是遵循各子系统已经形成的真实风格边界，在增量修改时保持一致、可读、可维护。

## 覆盖范围

- `chat/` 用户前端
- `admin/` 管理后台前端
- `service/` NestJS 后端
- 部署脚本与文档

## 总原则

- 修改时优先服从“所在模块的现有风格”，不要跨模块强行统一。
- 只改与当前任务直接相关的文件，不顺手重排、重命名、重格式化无关代码。
- `chat/`、`admin/`、`service/` 各自有独立格式规则；发生冲突时，以模块本地配置和相邻文件风格为准。
- 不编辑生成产物，例如 `dist/`。
- 能沿用现有目录结构、命名方式、API 包装和状态管理方式时，不另起炉灶。
- 历史代码里存在的 `any`、空 `catch`、重复逻辑等问题，不应在新代码里继续扩散。

## 目录级边界

### `chat/`

- 面向用户的 Vue 3 工作区。
- 保持现有“无分号”风格。
- 以 `Pinia + hooks + 单文件组件` 为主。
- 文件面板、工具执行展示和终端交互 UI 暂时保留，后续接 OpenSandbox。

### `admin/`

- Vue 3 + Vite 管理后台。
- 保持现有“有分号”风格。
- 以 `Element Plus + 路由菜单模块 + setup store` 为主。

### `service/`

- NestJS 后端。
- 保持现有“有分号”风格。
- 以“按业务模块分目录”的方式组织控制器、服务、实体和 DTO。

## 全局工作方式

### 1. 先看配置，再看邻近文件

新增或修改代码前，优先检查：

- 模块本地格式配置：`.prettierrc`、`.editorconfig`
- 相邻同类文件的写法
- 当前目录是否已有固定结构，例如 `store/modules`、`api/modules`、`src/modules/<domain>`、`scripts/*.sh`

### 2. 避免跨模块格式污染

- 不把 `admin/service` 的分号风格带到 `chat/`
- 不把 `chat/` 的无分号风格带到 `admin/service`
- 不把前端状态管理模式搬进后端服务层

### 3. 注释风格

- 优先写“解释原因/约束”的注释，而不是翻译代码动作。
- 仓库现有注释以中文业务说明为主；新增注释优先保持中文。
- 对一眼能看懂的赋值、调用和条件判断，不额外加注释。

### 4. 类型与错误处理

- 尽量补足明确类型，不新引入无必要的 `any`。
- 历史代码中存在空 `catch`；新代码除非和周边保持一致且有明确理由，否则应至少记录、透传或显式忽略原因。
- 业务边界处优先返回可诊断的信息，尤其是后端接口、搜索、模型配置读取这些边界层。

## `chat/` 前端风格

依据 [chat/.prettierrc](../../chat/.prettierrc)：

- 无分号
- 单引号
- 两空格缩进
- `printWidth = 100`
- `trailingComma = es5`
- `arrowParens = avoid`

推荐：

- 页面与组件采用 Vue 3 单文件组件，主流写法是 `<script setup lang="ts">`。
- 聊天相关页面位于 `src/views/chat/**`，复杂逻辑拆到 `hooks/` 和 `components/`。
- 状态管理位于 `src/store/modules/<domain>/index.ts` 与 `helper.ts`。
- API 调用位于 `src/api/*.ts` 或对应模块文件中，函数名通常使用 `fetchXxxAPI`。

不要做：

- 不要把 `chat/` 文件批量格式化成有分号风格。
- 不要无故把 Options Store 全量改写成 Setup Store。
- 不要脱离现有目录约定新增零散 util 文件。

## `admin/` 前端风格

依据 [admin/.prettierrc](../../admin/.prettierrc)：

- 有分号
- 单引号
- 两空格缩进
- `printWidth = 100`
- `trailingComma = all`
- `arrowParens = always`
- `vueIndentScriptAndStyle = true`

推荐：

- API 模块保持默认导出对象风格，例如 `export default { queryConfig, setConfig }`。
- Store 常用 `defineStore(id, () => { ... })` 的 Setup Store 写法。
- 管理台页面默认使用 `Element Plus` 组件体系。
- 菜单与路由元信息写在对应 `*.menu.ts` 文件中，不分散到页面文件。

不要做：

- 不要把 `admin/` API 模块改成 `chat/` 那种零散命名函数风格，除非当前文件本来就这么写。
- 不要引入与现有 `Element Plus` 生态割裂的新 UI 组织模式。

## `service/` 后端风格

依据 [service/.prettierrc](../../service/.prettierrc) 与 [service/.editorconfig](../../service/.editorconfig)：

- 有分号
- 单引号
- 两空格缩进
- `printWidth = 100`
- `trailingComma = all`
- `endOfLine = lf`

模块结构：

- `src/modules/<domain>/<domain>.module.ts`
- `src/modules/<domain>/<domain>.controller.ts`
- `src/modules/<domain>/<domain>.service.ts`
- `src/modules/<domain>/<domain>.entity.ts`
- `src/modules/<domain>/dto/*.dto.ts`

推荐：

- 控制器尽量保持“薄”，参数校验、调用服务、返回结果为主。
- 业务逻辑放在 service 中。
- DTO 使用类，并配合 Swagger 注解，例如 `@ApiProperty`。
- Entity 使用 TypeORM 装饰器，显式声明字段类型和约束。
- 模块间依赖优先通过 service 注入，而不是跨层直接访问底层实现。
- 纯函数或解析逻辑可提到类外部，便于测试和复用。

不要做：

- 不要把控制器写成“大而全”的业务实现文件。
- 不要跳过 DTO/Swagger 直接把任意对象塞进接口层。
- 不要为局部需求新建与现有模块体系平行的第二套结构。

## 部署脚本风格

- Bash 脚本使用 `#!/usr/bin/env bash`。
- 开启 `set -euo pipefail`。
- 目录根路径通过脚本自身位置推导。
- 环境变量名使用全大写下划线。
- 局部变量使用小写蛇形。
- 所有路径和变量展开默认加双引号。
- 日志输出使用稳定前缀，例如 `==> Building ...`。

当前部署以 `Node + PM2` 为主。旧运行时打包流程已移除；后续 OpenSandbox 接入前，不要重新引入临时 Docker runtime 路径。

## 修改时的落地清单

开始改动前，默认检查以下项目：

1. 这个文件属于 `chat`、`admin`、`service` 还是部署脚本？
2. 该目录是否已经有本地格式配置？
3. 相邻同类文件的命名、导出方式、注释语言是否一致？
4. 当前改动是否会误把另一模块的风格带进来？
5. 如果触碰运行时方向，是否同步更新了 [当前状态](../current/system-status.md) 与 [OpenSandbox 方案](../current/opensandbox-runtime-plan.md)？
