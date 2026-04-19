# OpenWork 开发风格指南

这份文档用于约束后续对 OpenWork 仓库的修改方式。目标不是把所有模块硬拧成一种写法，而是遵循各子系统已经形成的真实风格边界，在增量修改时保持一致、可读、可维护。

本指南基于当前仓库中的配置文件、代表性源码和运行时脚本整理而来，覆盖：

- `chat/` 用户前端
- `admin/` 管理后台前端
- `service/` NestJS 后端
- `pi/` 工作区的补充规则
- 容器、运行时脚本与部署相关文件

## 总原则

- 修改时优先服从“所在模块的现有风格”，不要跨模块强行统一。
- 只改与当前任务直接相关的文件，不顺手重排、重命名、重格式化无关代码。
- `chat/`、`admin/`、`service/`、`pi/` 各自有独立格式规则；发生冲突时，以模块本地配置和相邻文件风格为准。
- 不编辑生成产物，例如 `dist/`。
- 能沿用现有目录结构、命名方式、API 包装和状态管理方式时，不另起炉灶。
- 历史代码里存在的 `any`、空 `catch`、重复逻辑等问题，不应在新代码里继续扩散。

## 目录级边界

### `chat/`

- 面向用户的 Vue 3 工作区。
- 保持现有“无分号”风格。
- 以 `Pinia + hooks + 单文件组件` 为主。

### `admin/`

- Vue 3 + Vite 管理后台。
- 保持现有“有分号”风格。
- 以 `Element Plus + 路由菜单模块 + setup store` 为主。

### `service/`

- NestJS 后端。
- 保持现有“有分号”风格。
- 以“按业务模块分目录”的方式组织控制器、服务、实体和 DTO。

### `pi/`

- 独立 npm workspace。
- 使用 Biome，采用与仓库其他目录不同的格式规则。
- 只在确实涉及 `pi/` 时才引入其风格，不把它反向带入 `chat/admin/service`。

## 全局工作方式

### 1. 先看配置，再看邻近文件

新增或修改代码前，优先检查：

- 模块本地格式配置：`.prettierrc`、`biome.json`、`.editorconfig`
- 相邻同类文件的写法
- 当前目录是否已有固定结构，例如 `store/modules`、`api/modules`、`src/modules/<domain>`、`scripts/*.sh`

### 2. 避免“跨模块格式污染”

明确保持以下边界：

- 不把 `admin/service` 的分号风格带到 `chat/`
- 不把 `chat/` 的无分号风格带到 `admin/service`
- 不把 `pi/` 的双引号 + Tab + Biome 风格带到其他目录

### 3. 注释风格

- 优先写“解释原因/约束”的注释，而不是翻译代码动作。
- 仓库现有注释以中文业务说明为主；新增注释优先保持中文。
- 对一眼能看懂的赋值、调用和条件判断，不额外加注释。

### 4. 类型与错误处理

- 尽量补足明确类型，不新引入无必要的 `any`。
- 历史代码中存在空 `catch`；新代码除非和周边保持一致且有明确理由，否则应至少记录、透传或显式忽略原因。
- 业务边界处优先返回可诊断的信息，尤其是后端接口、容器脚本和运行时管理逻辑。

## `chat/` 前端风格

### 格式规则

依据 [chat/.prettierrc](/Users/apple/workplace-frontend/openwork/chat/.prettierrc)：

- 无分号
- 单引号
- 两空格缩进
- `printWidth = 100`
- `trailingComma = es5`
- `arrowParens = avoid`

### 代码组织

- 页面与组件采用 Vue 3 单文件组件，主流写法是 `<script setup lang="ts">`。
- 聊天相关页面位于 `src/views/chat/**`，复杂逻辑拆到 `hooks/` 和 `components/`。
- 状态管理位于 `src/store/modules/<domain>/index.ts` 与 `helper.ts`。
- API 调用位于 `src/api/*.ts` 或对应模块文件中，函数名通常使用 `fetchXxxAPI`。

### 推荐写法

- 复用现有 store 模式：`defineStore('xxx-store', { state, getters, actions })`
- 纯状态初始化、持久化、格式转换等逻辑放入 `helper.ts`
- 组合逻辑优先抽成 `useXxx` hook，而不是把所有逻辑堆进组件
- 模板层延续现有 Tailwind 工具类组合方式
- 新增 API 时保持“薄封装”风格，例如：
  - `return get<T>({ url: '/models/list' })`

### 命名与约定

- store 名称常见格式：`useChatStore`、`useGlobalStoreWithOut`
- API 名称常见格式：`fetchQueryModelsListAPI`
- 中文业务注释可保留，但避免过度重复

### 不要做的事

- 不要把 `chat/` 文件批量格式化成有分号风格
- 不要无故把 Options Store 全量改写成 Setup Store
- 不要脱离现有目录约定新增零散 util 文件

## `admin/` 前端风格

### 格式规则

依据 [admin/.prettierrc](/Users/apple/workplace-frontend/openwork/admin/.prettierrc)：

- 有分号
- 单引号
- 两空格缩进
- `printWidth = 100`
- `trailingComma = all`
- `arrowParens = always`
- `vueIndentScriptAndStyle = true`

### 代码组织

- API 模块位于 `src/api/modules/*.ts`
- 路由菜单位于 `src/router/modules/*.menu.ts`
- 状态管理位于 `src/store/modules/*.ts`
- 视图位于 `src/views/**`

### 推荐写法

- API 模块保持默认导出对象风格，例如 `export default { queryConfig, setConfig }`
- Store 常用 `defineStore(id, () => { ... })` 的 Setup Store 写法
- 管理台页面默认使用 `Element Plus` 组件体系
- 页面内表单、上传、列表逻辑通常直接写在 `setup` 中，必要时再抽 composable
- 菜单与路由元信息写在对应 `*.menu.ts` 文件中，不分散到页面文件

### 命名与约定

- 页面文件使用小驼峰或业务名，例如 `baseConfiguration.vue`
- 路由名、菜单名采用明确业务命名，如 `ClientBaseConfig`
- 默认配置集中在 `settings.default.ts` 一类文件中

### 不要做的事

- 不要把 `admin/` API 模块改成 `chat/` 那种零散命名函数风格，除非当前文件本来就这么写
- 不要引入与现有 `Element Plus` 生态割裂的新 UI 组织模式
- 不要把单页菜单配置拆到过多零散文件

## `service/` 后端风格

### 格式规则

依据 [service/.prettierrc](/Users/apple/workplace-frontend/openwork/service/.prettierrc) 与 [service/.editorconfig](/Users/apple/workplace-frontend/openwork/service/.editorconfig)：

- 有分号
- 单引号
- 两空格缩进
- `printWidth = 100`
- `trailingComma = all`
- `endOfLine = lf`
- Markdown 不强制裁切已有长行，但保持可读

### 模块结构

后端按业务模块组织，保持如下模式：

- `src/modules/<domain>/<domain>.module.ts`
- `src/modules/<domain>/<domain>.controller.ts`
- `src/modules/<domain>/<domain>.service.ts`
- `src/modules/<domain>/<domain>.entity.ts`
- `src/modules/<domain>/dto/*.dto.ts`

新增后端能力时，优先放进现有业务模块；只有确实形成独立边界时才新建模块。

### 推荐写法

- 控制器尽量保持“薄”，参数校验、调用服务、返回结果为主
- 业务逻辑放在 service 中
- DTO 使用类，并配合 Swagger 注解，例如 `@ApiProperty`
- Entity 使用 TypeORM 装饰器，显式声明字段类型和约束
- 模块间依赖优先通过 service 注入，而不是跨层直接访问底层实现
- 纯函数或解析逻辑可提到类外部，便于测试和复用

### 日志、注释与错误

- 现有后端日志、Swagger 描述和业务注释以中文为主，新增内容优先沿用中文
- 对外错误信息要可诊断，尤其是容器、搜索、模型代理、配置读取这些边界层
- 可以保留现有 `Logger` / `console` 组合方式，但新增逻辑优先考虑统一日志语义

### 命名与约定

- 类名使用 PascalCase
- DTO 名称使用 `XxxDto`
- Controller/Service/Module/Entity 文件名沿用当前目录命名
- 环境变量统一使用大写下划线命名
- 常量使用全大写蛇形或语义明确的 `const`

### 不要做的事

- 不要把控制器写成“大而全”的业务实现文件
- 不要跳过 DTO/Swagger 直接把任意对象塞进接口层
- 不要为局部需求新建与现有模块体系平行的第二套结构

## `pi/` 工作区补充风格

依据 [pi/biome.json](/Users/apple/workplace-frontend/openwork/pi/biome.json) 与 [pi/AGENTS.md](/Users/apple/workplace-frontend/openwork/pi/AGENTS.md)：

- 使用 Biome，不使用 `chat/admin/service` 的 Prettier 风格
- 双引号
- 分号
- Tab 缩进
- `lineWidth = 120`
- 运行时代码避免 inline/dynamic import
- 除非确有必要，不引入 `any`
- Node 内置模块优先使用 `node:` 前缀导入

如果修改 `pi/`：

- 先看 `pi/README.md`
- 修改后运行 `cd /Users/apple/workplace-frontend/openwork/pi && npm run check`
- 保持运行时通用，不把产品专属流程塞进默认 runtime

## 容器与运行时脚本风格

### 当前架构事实

- 主服务部署以 `Node + PM2` 为主
- Docker 主要用于“按用户隔离的 PI runtime 容器”
- 不要把仓库重新改回“单体 Docker Compose 承载全部线上部署”的思路

### Shell 脚本

#### Bash 脚本

参考 [build.sh](/Users/apple/workplace-frontend/openwork/build.sh)、[pi/scripts/build-runtime-image.sh](/Users/apple/workplace-frontend/openwork/pi/scripts/build-runtime-image.sh)、[pi/scripts/reload-runtime-containers.sh](/Users/apple/workplace-frontend/openwork/pi/scripts/reload-runtime-containers.sh)：

- 文件头使用 `#!/usr/bin/env bash`
- 开启 `set -euo pipefail`
- 目录根路径通过脚本自身位置推导
- 环境变量名使用全大写下划线
- 局部变量使用小写蛇形
- 所有路径和变量展开默认加双引号
- 日志输出使用稳定前缀，例如 `==> Building ...`

#### POSIX `sh` 入口脚本

参考 [pi/scripts/runtime-entrypoint.sh](/Users/apple/workplace-frontend/openwork/pi/scripts/runtime-entrypoint.sh)：

- 文件头使用 `#!/bin/sh`
- 开启 `set -eu`
- 启动前先验证关键环境变量、版本号、目录和归档文件
- 对非法输入尽早失败，并把错误写到 `stderr`
- 对版本、路径、挂载点等做显式校验，不依赖隐式行为

### Dockerfile

参考 [pi/Dockerfile.runtime](/Users/apple/workplace-frontend/openwork/pi/Dockerfile.runtime)：

- 基础镜像尽量明确、精简，例如 `node:22-bookworm-slim`
- `ENV` 一行一个语义组，保持可读
- 安装系统依赖时使用最小集合，并清理缓存
- 运行时容器优先使用非 root 用户
- 入口命令保持单一职责，复杂逻辑放到脚本里

`service/Dockerfile` 属于历史遗留风格，后续若调整容器化策略，应优先对齐当前 runtime 容器的最小化和安全化方式，而不是继续扩大旧式写法。

### 容器命名与约束

参考 [service/src/modules/aiTool/chat/piRuntimeManager.ts](/Users/apple/workplace-frontend/openwork/service/src/modules/aiTool/chat/piRuntimeManager.ts)：

- 用户运行时容器名：`openwork-user-<userId>`
- 工作区卷名：`openwork-user-<userId>-workspace`
- 容器 label：`openwork.pi.runtime=1`
- 环境变量使用 `PI_*` / `OPENWORK_*` 前缀
- 容器侧配置优先通过显式环境变量和挂载目录传入

## 修改时的落地清单

开始改动前，默认检查以下项目：

1. 这个文件属于 `chat`、`admin`、`service`、`pi` 还是容器脚本？
2. 该目录是否已经有本地格式配置？
3. 相邻同类文件的命名、导出方式、注释语言是否一致？
4. 当前改动是否会误把另一模块的风格带进来？
5. 如果改了 `pi/` 或运行时脚本，是否同时遵守了部署与容器约束？

## 后续执行约束

从这份文档起，后续对本仓库的修改默认遵循：

- `chat/` 保持无分号 Vue 前端风格
- `admin/` 保持有分号管理台风格
- `service/` 保持 Nest 模块化后端风格
- `pi/` 保持 Biome 双引号 + Tab 风格
- 容器与运行时脚本保持“显式校验、最小职责、按用户隔离”的实现方式

如果未来仓库风格发生系统性调整，应先更新本文档，再批量修改代码。
