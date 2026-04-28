#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-${ROOT_DIR}/deploy}"

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

echo "==> Assembling deploy directory: ${DEPLOY_DIR}"
mkdir -p \
  "${DEPLOY_DIR}/dist" \
  "${DEPLOY_DIR}/public/admin" \
  "${DEPLOY_DIR}/public/chat"

rm -rf \
  "${DEPLOY_DIR}/dist"/* \
  "${DEPLOY_DIR}/public/admin"/* \
  "${DEPLOY_DIR}/public/chat"/*

# Remove deployment files from older Docker/runtime packages.
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

chmod +x "${DEPLOY_DIR}/start.sh"

echo "==> Deploy package ready"
echo "    directory: ${DEPLOY_DIR}"
echo "    next on server: cd deploy && ./start.sh"
