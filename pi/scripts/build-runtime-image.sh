#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE_NAME="${PI_RUNTIME_IMAGE_NAME:-openwork-runtime:latest}"

cd "${ROOT_DIR}"

echo "==> Building runtime image: ${IMAGE_NAME}"
docker build -f Dockerfile.runtime -t "${IMAGE_NAME}" .
echo "==> Runtime image ready: ${IMAGE_NAME}"
