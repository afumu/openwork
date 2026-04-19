# 运行时打包产物

运行时 bundle 是 PI 运行时层的可部署发布包。

## 打包内容

- `packages/ai/dist`
- `packages/agent/dist`
- `packages/coding-agent/dist`
- `packages/tui/dist`
- `.pi`
- `runtime/openwork.js`

## 构建

```bash
cd pi
npm run build:runtime-bundle -- <version>
```

## 发布位置

默认发布目录：

```text
~/.openwork/runtime-bundles
```

当前被选中的版本通过 `current.txt` 记录。

## 运行时入口

容器会解压该发布包，然后启动：

```bash
node runtime/openwork.js
```
