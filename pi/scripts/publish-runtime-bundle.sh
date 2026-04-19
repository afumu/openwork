#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="${PI_RUNTIME_SOURCE_DIR:-${ROOT_DIR}/runtime-bundles}"
DEFAULT_PUBLISH_DIR="${HOME:-/tmp}/.openwork/runtime-bundles"
TARGET_DIR="${PI_RUNTIME_PUBLISH_DIR:-${DEFAULT_PUBLISH_DIR}}"
VERSION="${1:-}"

if [[ -z "${VERSION}" ]]; then
  if [[ -f "${SOURCE_DIR}/current.txt" ]]; then
    VERSION="$(tr -d '[:space:]' < "${SOURCE_DIR}/current.txt")"
  fi
fi

if [[ -z "${VERSION}" ]]; then
  echo "Runtime bundle version is empty. Pass a version or generate current.txt first." >&2
  exit 1
fi

if [[ ! "${VERSION}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Invalid runtime bundle version: ${VERSION}" >&2
  exit 1
fi

ARCHIVE_NAME="pi-runtime-${VERSION}.tar.gz"
SOURCE_ARCHIVE="${SOURCE_DIR}/${ARCHIVE_NAME}"
TARGET_ARCHIVE="${TARGET_DIR}/${ARCHIVE_NAME}"

if [[ ! -f "${SOURCE_ARCHIVE}" ]]; then
  echo "Runtime bundle not found: ${SOURCE_ARCHIVE}" >&2
  exit 1
fi

mkdir -p "${TARGET_DIR}"
cp "${SOURCE_ARCHIVE}" "${TARGET_ARCHIVE}"
printf '%s\n' "${VERSION}" > "${TARGET_DIR}/current.txt"

echo "==> Published runtime bundle:"
echo "    archive: ${TARGET_ARCHIVE}"
echo "    current: ${TARGET_DIR}/current.txt -> ${VERSION}"
