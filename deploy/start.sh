#!/usr/bin/env bash

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${DEPLOY_DIR}/.env"
ENV_EXAMPLE="${DEPLOY_DIR}/.env.example"
APP_NAME="${PM2_APP_NAME:-openwork}"
LEGACY_APP_NAMES="${PM2_LEGACY_APP_NAMES:-99AI}"

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

ensure_env_file() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    if [[ ! -f "${ENV_EXAMPLE}" ]]; then
      echo "Missing .env and .env.example in ${DEPLOY_DIR}" >&2
      exit 1
    fi

    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    echo "==> Created .env from .env.example"
  fi
}

ensure_env_key() {
  local key="$1"
  local value="$2"

  if ! grep -Eq "^${key}=" "${ENV_FILE}"; then
    printf '\n%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

env_value_or_default() {
  local key="$1"
  local default_value="$2"
  local value

  value="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 | cut -d= -f2- || true)"
  if [[ -z "${value}" ]]; then
    printf '%s\n' "${default_value}"
    return
  fi

  printf '%s\n' "${value}"
}

pid_listening_on_port() {
  local port="$1"
  lsof -nP -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
}

ensure_service_port_available() {
  local port="$1"
  local pids

  pids="$(pid_listening_on_port "${port}")"
  if [[ -z "${pids}" ]]; then
    return
  fi

  if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
    local pm2_pid
    pm2_pid="$(PM2_APP_NAME="${APP_NAME}" pm2 jlist | node -e "let data='';process.stdin.on('data',d=>data+=d);process.stdin.on('end',()=>{const apps=JSON.parse(data||'[]');const app=apps.find(item=>item.name===process.env.PM2_APP_NAME);process.stdout.write(app?.pid ? String(app.pid) : '')})")"
    if [[ -n "${pm2_pid}" ]] && grep -qx "${pm2_pid}" <<<"${pids}"; then
      return
    fi

    while IFS= read -r pid; do
      [[ -n "${pid}" ]] || continue
      if ps -p "${pid}" -o command= 2>/dev/null | grep -q 'PM2 .*God Daemon'; then
        return
      fi
    done <<<"${pids}"
  fi

  echo "Port ${port} is already occupied by another process:" >&2
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN >&2 || true
  echo >&2
  echo "Stop that process first, or rerun with OPENWORK_STOP_PORT_PROCESS=1 to let this script stop it." >&2

  if [[ "${OPENWORK_STOP_PORT_PROCESS:-0}" != "1" ]]; then
    exit 1
  fi

  echo "==> Stopping process(es) occupying port ${port}: ${pids}"
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    kill "${pid}"
  done <<<"${pids}"

  sleep 2

  if [[ -n "$(pid_listening_on_port "${port}")" ]]; then
    echo "Port ${port} is still occupied after graceful stop. Please check it manually." >&2
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >&2 || true
    exit 1
  fi
}

install_runtime_dependencies() {
  if [[ -f "${DEPLOY_DIR}/pnpm-lock.yaml" ]]; then
    pnpm install --prod --frozen-lockfile || pnpm install --prod
    return
  fi

  pnpm install --prod
}

stop_legacy_pm2_apps() {
  local legacy_name

  for legacy_name in ${LEGACY_APP_NAMES}; do
    if [[ -z "${legacy_name}" || "${legacy_name}" == "${APP_NAME}" ]]; then
      continue
    fi

    if pm2 describe "${legacy_name}" >/dev/null 2>&1; then
      echo "==> Removing legacy PM2 app: ${legacy_name}"
      pm2 delete "${legacy_name}"
    fi
  done
}

start_or_reload_pm2() {
  if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
    pm2 reload "${DEPLOY_DIR}/pm2.conf.json" --update-env
    return
  fi

  pm2 start "${DEPLOY_DIR}/pm2.conf.json" --update-env
}

cd "${DEPLOY_DIR}"

require_command node
require_command pnpm
require_command pm2
ensure_env_file

SERVICE_PORT="$(env_value_or_default "PORT" "9527")"

echo "==> Installing service production dependencies"
install_runtime_dependencies

echo "==> Starting main service with PM2"
stop_legacy_pm2_apps
ensure_service_port_available "${SERVICE_PORT}"
start_or_reload_pm2

pm2 status

cat <<EOF

OpenWork service startup command finished.

Main service:
  http://127.0.0.1:${SERVICE_PORT}

Useful checks:
  pm2 status
  pm2 logs ${APP_NAME}
EOF
