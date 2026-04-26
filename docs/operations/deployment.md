# 部署说明

OpenWork 的主服务使用 Node + PM2 运行；按对话组隔离的运行时容器则通过 Docker 承载。

## 主要组成

1. 主服务：由 PM2 托管的 `service/dist`
2. 前端产物：`admin/dist` 与 `chat/dist`
3. 运行时镜像：`openwork-runtime:latest`
4. 运行时打包产物：默认发布到 `~/.openwork/runtime-bundles`

## 关键环境变量

- `PI_DOCKER_ENABLED`
- `PI_DOCKER_IMAGE`
- `PI_DOCKER_RUNTIME_BUNDLE_HOST_PATH`
- `OPENWORK_INTERNAL_SEARCH_URL`
- `OPENWORK_INTERNAL_SEARCH_TOKEN`

## 推荐流程

1. 运行 `./build.sh`
2. 如果运行时代码有改动，发布新的运行时打包产物
3. 重启主服务
4. 当打包产物或版本变更时，重启用户运行时容器
