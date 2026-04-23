#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="${PI_RUNTIME_IMAGE_NAME:-${PI_DOCKER_IMAGE:-openwork-runtime:latest}}"
PUBLISH_DIR="${PI_RUNTIME_PUBLISH_DIR:-${PI_DOCKER_RUNTIME_BUNDLE_HOST_PATH:-${HOME}/.openwork/runtime-bundles}}"
CURRENT_FILE="${PUBLISH_DIR}/current.txt"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker: missing"
  exit 1
fi

echo "PI runtime package:"
echo "  source: ${SCRIPT_DIR}"

if docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1; then
  image_id="$(docker image inspect "${IMAGE_NAME}" --format '{{.Id}}')"
  echo "  image: ${IMAGE_NAME} (${image_id})"
else
  echo "  image: missing (${IMAGE_NAME})"
fi

if [[ -f "${CURRENT_FILE}" ]]; then
  version="$(tr -d '[:space:]' < "${CURRENT_FILE}")"
  echo "  current: ${version}"
  if [[ -f "${PUBLISH_DIR}/pi-runtime-${version}.tar.gz" ]]; then
    echo "  bundle: ${PUBLISH_DIR}/pi-runtime-${version}.tar.gz"
  else
    echo "  bundle: missing ${PUBLISH_DIR}/pi-runtime-${version}.tar.gz"
  fi
else
  echo "  current: missing (${CURRENT_FILE})"
fi

echo
echo "Existing PI user containers:"
docker ps -a --filter "label=openwork.pi.runtime=1" --format '  {{.Names}}\t{{.Image}}\t{{.Status}}' || true
