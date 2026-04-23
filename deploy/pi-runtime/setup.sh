#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="${PI_RUNTIME_IMAGE_NAME:-${PI_DOCKER_IMAGE:-openwork-runtime:latest}}"
PUBLISH_DIR="${PI_RUNTIME_PUBLISH_DIR:-${PI_DOCKER_RUNTIME_BUNDLE_HOST_PATH:-${HOME}/.openwork/runtime-bundles}}"
BUNDLE_DIR="${SCRIPT_DIR}/runtime-bundles"
CURRENT_FILE="${BUNDLE_DIR}/current.txt"

if ! command -v docker >/dev/null 2>&1; then
  echo "Missing required command: docker" >&2
  exit 1
fi

if [[ ! -f "${SCRIPT_DIR}/Dockerfile.runtime" ]]; then
  echo "Missing PI runtime Dockerfile: ${SCRIPT_DIR}/Dockerfile.runtime" >&2
  exit 1
fi

if [[ ! -f "${CURRENT_FILE}" ]]; then
  echo "Missing PI runtime current.txt: ${CURRENT_FILE}" >&2
  exit 1
fi

VERSION="$(tr -d '[:space:]' < "${CURRENT_FILE}")"
if [[ -z "${VERSION}" ]]; then
  echo "PI runtime version is empty in ${CURRENT_FILE}" >&2
  exit 1
fi

if [[ ! "${VERSION}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Invalid PI runtime version: ${VERSION}" >&2
  exit 1
fi

ARCHIVE_NAME="pi-runtime-${VERSION}.tar.gz"
ARCHIVE_PATH="${BUNDLE_DIR}/${ARCHIVE_NAME}"

if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "Missing PI runtime bundle: ${ARCHIVE_PATH}" >&2
  exit 1
fi

echo "==> Building PI runtime image: ${IMAGE_NAME}"
docker build -f "${SCRIPT_DIR}/Dockerfile.runtime" -t "${IMAGE_NAME}" "${SCRIPT_DIR}"

echo "==> Publishing PI runtime bundle: ${VERSION}"
mkdir -p "${PUBLISH_DIR}"
cp "${ARCHIVE_PATH}" "${PUBLISH_DIR}/${ARCHIVE_NAME}"
printf '%s\n' "${VERSION}" > "${PUBLISH_DIR}/current.txt"

echo "==> PI runtime is ready"
echo "    image: ${IMAGE_NAME}"
echo "    bundle: ${PUBLISH_DIR}/${ARCHIVE_NAME}"
echo "    current: ${PUBLISH_DIR}/current.txt -> ${VERSION}"

if [[ "${RESTART_PI_CONTAINERS:-0}" == "1" ]]; then
  containers=()
  while IFS= read -r container_name; do
    [[ -n "${container_name}" ]] || continue
    containers+=("${container_name}")
  done < <(docker ps -a --filter "label=openwork.pi.runtime=1" --format '{{.Names}}')
  if [[ "${#containers[@]}" -gt 0 ]]; then
    echo "==> Restarting existing PI runtime containers"
    docker restart "${containers[@]}" >/dev/null
  fi
fi
