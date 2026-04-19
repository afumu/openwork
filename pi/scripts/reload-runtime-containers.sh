#!/usr/bin/env bash

set -euo pipefail

DOCKER_BIN="${PI_DOCKER_BINARY:-docker}"
TARGET="${1:-}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/reload-runtime-containers.sh <userId>
  bash scripts/reload-runtime-containers.sh --all

Behavior:
  - Restart `openwork-user-<userId>` to make it reload the latest runtime bundle
  - Or restart all containers labeled `openwork.pi.runtime=1`
EOF
}

restart_container() {
  local container_name="$1"
  echo "==> Restarting ${container_name}"
  "${DOCKER_BIN}" restart "${container_name}" >/dev/null
  echo "    restarted"
}

if [[ -z "${TARGET}" ]]; then
  usage >&2
  exit 1
fi

if [[ "${TARGET}" == "--all" ]]; then
  containers=()
  while IFS= read -r container_name; do
    [[ -n "${container_name}" ]] || continue
    containers+=("${container_name}")
  done < <("${DOCKER_BIN}" ps -a --filter "label=openwork.pi.runtime=1" --format '{{.Names}}')

  if [[ "${#containers[@]}" -eq 0 ]]; then
    echo "No PI runtime containers found."
    exit 0
  fi

  for container_name in "${containers[@]}"; do
    restart_container "${container_name}"
  done

  exit 0
fi

if [[ ! "${TARGET}" =~ ^[0-9]+$ ]]; then
  echo "Invalid userId: ${TARGET}" >&2
  usage >&2
  exit 1
fi

container_name="openwork-user-${TARGET}"

if ! "${DOCKER_BIN}" inspect "${container_name}" >/dev/null 2>&1; then
  echo "PI runtime container not found: ${container_name}" >&2
  exit 1
fi

restart_container "${container_name}"
