#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-${ROOT_DIR}/deploy}"
PI_PACKAGE_VERSION="$(node -p "require('${ROOT_DIR}/pi/package.json').version")"
PI_RUNTIME_VERSION="${PI_RUNTIME_VERSION:-${PI_PACKAGE_VERSION}-deploy.$(date +%Y%m%d%H%M%S)}"

echo "==> Building admin frontend"
cd "${ROOT_DIR}/admin"
pnpm install
pnpm build

echo "==> Building chat frontend"
cd "${ROOT_DIR}/chat"
pnpm install
pnpm build

echo "==> Building service"
cd "${ROOT_DIR}/service"
pnpm install
pnpm build

echo "==> Building PI runtime bundle: ${PI_RUNTIME_VERSION}"
cd "${ROOT_DIR}/pi"
npm run build:runtime-bundle -- "${PI_RUNTIME_VERSION}"

echo "==> Assembling deploy directory: ${DEPLOY_DIR}"
mkdir -p \
  "${DEPLOY_DIR}/dist" \
  "${DEPLOY_DIR}/public/admin" \
  "${DEPLOY_DIR}/public/chat" \
  "${DEPLOY_DIR}/pi-runtime/scripts" \
  "${DEPLOY_DIR}/pi-runtime/.pi/skills" \
  "${DEPLOY_DIR}/pi-runtime/runtime-bundles"

rm -rf \
  "${DEPLOY_DIR}/dist"/* \
  "${DEPLOY_DIR}/public/admin"/* \
  "${DEPLOY_DIR}/public/chat"/* \
  "${DEPLOY_DIR}/pi-runtime/runtime-bundles"/*

# Remove legacy Docker Compose deployment files from older packages. The main
# service is PM2-based; Docker is only used for per-user PI runtime containers.
rm -f \
  "${DEPLOY_DIR}/Dockerfile" \
  "${DEPLOY_DIR}/docker-compose.yml" \
  "${DEPLOY_DIR}/.dockerignore" \
  "${DEPLOY_DIR}/.env.docker" \
  "${DEPLOY_DIR}/public.zip"

cp "${ROOT_DIR}/service/pm2.conf.json" "${DEPLOY_DIR}/pm2.conf.json"
cp "${ROOT_DIR}/service/package.json" "${DEPLOY_DIR}/package.json"
cp "${ROOT_DIR}/service/pnpm-lock.yaml" "${DEPLOY_DIR}/pnpm-lock.yaml"
cp "${ROOT_DIR}/service/.env.example" "${DEPLOY_DIR}/.env.example"
cp "${ROOT_DIR}/service/default.png" "${DEPLOY_DIR}/default.png"

cp -a "${ROOT_DIR}/service/dist/." "${DEPLOY_DIR}/dist/"
cp -a "${ROOT_DIR}/admin/dist/." "${DEPLOY_DIR}/public/admin/"
cp -a "${ROOT_DIR}/chat/dist/." "${DEPLOY_DIR}/public/chat/"

cp "${ROOT_DIR}/pi/Dockerfile.runtime" "${DEPLOY_DIR}/pi-runtime/Dockerfile.runtime"
cp "${ROOT_DIR}/pi/scripts/runtime-entrypoint.sh" "${DEPLOY_DIR}/pi-runtime/scripts/runtime-entrypoint.sh"
cp -a "${ROOT_DIR}/pi/.pi/." "${DEPLOY_DIR}/pi-runtime/.pi/"
cp "${ROOT_DIR}/pi/runtime-bundles/current.txt" "${DEPLOY_DIR}/pi-runtime/runtime-bundles/current.txt"
cp \
  "${ROOT_DIR}/pi/runtime-bundles/pi-runtime-${PI_RUNTIME_VERSION}.tar.gz" \
  "${DEPLOY_DIR}/pi-runtime/runtime-bundles/pi-runtime-${PI_RUNTIME_VERSION}.tar.gz"
chmod +x \
  "${DEPLOY_DIR}/start.sh" \
  "${DEPLOY_DIR}/pi-runtime/setup.sh" \
  "${DEPLOY_DIR}/pi-runtime/check.sh" \
  "${DEPLOY_DIR}/pi-runtime/scripts/runtime-entrypoint.sh"

echo "==> Deploy package ready"
echo "    directory: ${DEPLOY_DIR}"
echo "    PI runtime version: ${PI_RUNTIME_VERSION}"
echo "    next on server: cd deploy && ./start.sh"
