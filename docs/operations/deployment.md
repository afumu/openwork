# 部署说明

OpenWork 当前部署包只包含主服务与前端产物。运行时容器能力将在后续 OpenSandbox 改造中重新接入。

## 主要组成

1. 主服务：由 PM2 托管的 `service/dist`
2. 前端产物：`admin/dist` 与 `chat/dist`
3. 配置文件：由 `service/.env.example` 初始化

## 推荐流程

1. 运行 `./build.sh`
2. 将 `deploy/` 发布到服务器
3. 在服务器执行 `cd deploy && ./start.sh`
4. 通过 `pm2 status` 与 `pm2 logs openwork` 检查服务状态

## 说明

- `./build.sh` 不再构建或发布独立运行时包。
- `deploy/start.sh` 不再要求 Docker。
- 后续接入 OpenSandbox 时，再补充 sandbox 配置、镜像发布和运行时健康检查流程。
