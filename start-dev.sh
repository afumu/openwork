#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

require_command() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "Missing required command: ${name}" >&2
    exit 1
  fi
}

require_dir() {
  local dir="$1"
  if [[ ! -d "${dir}" ]]; then
    echo "Missing required directory: ${dir}" >&2
    exit 1
  fi
}

ensure_node_modules() {
  local dir="$1"
  if [[ ! -d "${dir}/node_modules" ]]; then
    echo "Missing dependencies in ${dir}. Run pnpm install there first." >&2
    exit 1
  fi
}

ensure_service_env() {
  if [[ -f "${ROOT_DIR}/service/.env" ]]; then
    return
  fi
  if [[ ! -f "${ROOT_DIR}/service/.env.example" ]]; then
    echo "Missing service/.env and service/.env.example" >&2
    exit 1
  fi

  cp "${ROOT_DIR}/service/.env.example" "${ROOT_DIR}/service/.env"
  echo "Created service/.env from service/.env.example"
}

run_with_prefix() {
  local name="$1"
  local dir="$2"

  (
    cd "${dir}"
    pnpm dev 2>&1 | awk -v prefix="[${name}] " '{ print prefix $0; fflush(); }'
  ) &
  PIDS+=($!)
}

cleanup() {
  local exit_code=$?
  trap - INT TERM EXIT
  if [[ "${#PIDS[@]}" -gt 0 ]]; then
    kill "${PIDS[@]}" 2>/dev/null || true
    wait "${PIDS[@]}" 2>/dev/null || true
  fi
  exit "${exit_code}"
}

require_command pnpm
require_dir "${ROOT_DIR}/admin"
require_dir "${ROOT_DIR}/chat"
require_dir "${ROOT_DIR}/service"
ensure_node_modules "${ROOT_DIR}/admin"
ensure_node_modules "${ROOT_DIR}/chat"
ensure_node_modules "${ROOT_DIR}/service"
ensure_service_env

declare -a PIDS=()
trap cleanup INT TERM EXIT

echo "Starting OpenWork source services..."
echo "  admin:   http://127.0.0.1:9000"
echo "  chat:    http://127.0.0.1:9002"
echo "  service: http://127.0.0.1:9527"
echo

run_with_prefix admin "${ROOT_DIR}/admin"
run_with_prefix chat "${ROOT_DIR}/chat"
run_with_prefix service "${ROOT_DIR}/service"

while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      wait "${pid}"
      exit $?
    fi
  done
  sleep 1
done
