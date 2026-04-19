#!/bin/sh
set -eu

workspace_dir="${PI_RUNTIME_WORKSPACE_ROOT:-/workspace}"
bundle_dir="${PI_RUNTIME_BUNDLE_DIR:-/mnt/pi-runtime-bundles}"
runtime_root="${PI_RUNTIME_RELEASES_ROOT:-${workspace_dir}/.pi-runtime}"
releases_dir="${runtime_root}/releases"
current_link="${runtime_root}/current"
runtime_version="${PI_RUNTIME_VERSION:-}"
version_file="${PI_RUNTIME_VERSION_FILE:-${bundle_dir}/current.txt}"

mkdir -p "${workspace_dir}" "${runtime_root}" "${releases_dir}"

if [ -z "${runtime_version}" ] && [ -f "${version_file}" ]; then
  runtime_version="$(tr -d '[:space:]' < "${version_file}")"
fi

if [ -z "${runtime_version}" ]; then
  echo "PI runtime version is empty. Set PI_RUNTIME_VERSION or provide ${version_file}." >&2
  exit 1
fi

case "${runtime_version}" in
  *[!A-Za-z0-9._-]*)
    echo "Invalid PI runtime version: ${runtime_version}" >&2
    exit 1
    ;;
esac

archive_path="${bundle_dir}/pi-runtime-${runtime_version}.tar.gz"
release_dir="${releases_dir}/${runtime_version}"
extract_marker="${release_dir}/.bundle-ready"

if [ ! -f "${archive_path}" ]; then
  echo "PI runtime bundle not found: ${archive_path}" >&2
  exit 1
fi

if [ ! -f "${extract_marker}" ]; then
  tmp_dir="${releases_dir}/.tmp-${runtime_version}-$$"
  rm -rf "${tmp_dir}"
  mkdir -p "${tmp_dir}"
  tar -xzf "${archive_path}" -C "${tmp_dir}"
  rm -rf "${release_dir}"
  mv "${tmp_dir}/pi-runtime" "${release_dir}"
  touch "${extract_marker}"
  rm -rf "${tmp_dir}"
fi

rm -rf "${current_link}"
ln -s "${release_dir}" "${current_link}"

if [ ! -d "${workspace_dir}/.pi" ]; then
  cp -R "${current_link}/.pi" "${workspace_dir}/.pi"
else
  cp -R "${current_link}/.pi/." "${workspace_dir}/.pi/" 2>/dev/null || true
fi

rm -f "${workspace_dir}/.pi/auth.json" "${workspace_dir}/.pi/models.json"

cd "${current_link}"
exec node runtime/openwork.js
