#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="${ROOT_DIR}/runtime-bundles"
VERSION="${1:-}"
BUILD_IMAGE="${PI_RUNTIME_BUNDLE_BUILD_IMAGE:-node:22-bookworm-slim}"
BUILD_PLATFORM="${PI_RUNTIME_BUNDLE_BUILD_PLATFORM:-}"

if [[ -z "${VERSION}" ]]; then
  VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
fi

if [[ ! "${VERSION}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Invalid runtime bundle version: ${VERSION}" >&2
  exit 1
fi

ARCHIVE_NAME="pi-runtime-${VERSION}.tar.gz"
ARCHIVE_PATH="${OUTPUT_DIR}/${ARCHIVE_NAME}"

STAGE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pi-runtime-bundle.XXXXXX")"
BUILD_ROOT="${STAGE_ROOT}/build-root"
OUTPUT_MOUNT="${STAGE_ROOT}/output"

cleanup() {
  rm -rf "${STAGE_ROOT}"
}
trap cleanup EXIT

mkdir -p "${OUTPUT_DIR}"
rm -f "${ARCHIVE_PATH}"
mkdir -p "${BUILD_ROOT}" "${OUTPUT_MOUNT}"

echo "==> Preparing isolated Linux build context..."
tar \
  --exclude='./node_modules' \
  --exclude='./runtime-bundles' \
  --exclude='./packages/*/dist' \
  --exclude='./packages/web-ui/dist' \
  --exclude='./packages/*/node_modules' \
  -cf - \
  -C "${ROOT_DIR}" \
  . | tar -xf - -C "${BUILD_ROOT}"

DOCKER_ARGS=(run --rm)
if [[ -n "${BUILD_PLATFORM}" ]]; then
  DOCKER_ARGS+=(--platform "${BUILD_PLATFORM}")
fi
DOCKER_ARGS+=(
  -v "${BUILD_ROOT}:/src"
  -v "${OUTPUT_MOUNT}:/out"
  -w /src
  "${BUILD_IMAGE}"
  bash
  -lc
)

read -r -d '' BUILD_COMMAND <<EOF || true
set -euo pipefail
echo "==> Installing dependencies in Linux build container..."
npm ci --include=dev
echo "==> Building runtime dependencies in Linux build container..."
npm run build
stage_root=\$(mktemp -d /tmp/pi-runtime-stage.XXXXXX)
stage_dir="\${stage_root}/pi-runtime"
mkdir -p "\${stage_dir}"
copy_path() {
  local source_path="\$1"
  local target_dir="\${stage_dir}/\$(dirname "\${source_path}")"
  mkdir -p "\${target_dir}"
  cp -R "/src/\${source_path}" "\${target_dir}/"
}
copy_path ".pi"
copy_path "node_modules"
copy_path "packages/ai/dist"
copy_path "packages/ai/package.json"
copy_path "packages/agent/dist"
copy_path "packages/agent/package.json"
copy_path "packages/coding-agent/dist"
copy_path "packages/coding-agent/package.json"
copy_path "packages/tui/dist"
copy_path "packages/tui/package.json"
copy_path "package.json"
copy_path "package-lock.json"
mkdir -p "\${stage_dir}/runtime"
cat > "\${stage_dir}/runtime/openwork.js" <<'WRAPPER'
import "../packages/coding-agent/dist/runtime/openwork.js";
WRAPPER

prune_runtime_sources() {
  if [[ -d "\${stage_dir}/packages" ]]; then
    find "\${stage_dir}/packages" -type f \\( \
      -name '*.map' -o \
      -name '*.d.ts' -o \
      -name '*.d.ts.map' -o \
      -name '*.d.mts' -o \
      -name '*.d.cts' \
    \\) -delete
  fi

  if [[ -d "\${stage_dir}/node_modules" ]]; then
    find "\${stage_dir}/node_modules" -type f \\( \
      -name '*.map' -o \
      -name '*.ts' -o \
      -name '*.tsx' -o \
      -name '*.mts' -o \
      -name '*.cts' -o \
      -name '*.d.ts' -o \
      -name '*.d.ts.map' -o \
      -name '*.d.mts' -o \
      -name '*.d.cts' \
    \\) -delete
    find "\${stage_dir}/node_modules" -type d -empty -delete
  fi
}

prune_runtime_sources
tar -czf "/out/${ARCHIVE_NAME}" -C "\${stage_root}" "pi-runtime"
EOF

echo "==> Building runtime bundle in Docker (${BUILD_IMAGE})..."
docker "${DOCKER_ARGS[@]}" "${BUILD_COMMAND}"

cp "${OUTPUT_MOUNT}/${ARCHIVE_NAME}" "${ARCHIVE_PATH}"

printf '%s\n' "${VERSION}" > "${OUTPUT_DIR}/current.txt"

echo "==> Runtime bundle ready: ${ARCHIVE_PATH}"
echo "==> current.txt updated to ${VERSION}"
