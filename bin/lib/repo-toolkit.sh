#!/usr/bin/env bash

repo_toolkit_api_get() {
  local url="$1"

  if [ -n "${GITHUB_API_TOKEN:-}" ]; then
    curl -s -H "Authorization: token $GITHUB_API_TOKEN" "$url"
    return
  fi

  curl -s "$url"
}

repo_toolkit_release_assets_url() {
  local github_coordinates="$1"
  local version="$2"
  local release_url="https://api.github.com/repos/${github_coordinates}/releases/tags/v${version}"
  local release_json
  local compact_release_json

  release_json=$(repo_toolkit_api_get "$release_url")
  compact_release_json=$(printf '%s' "$release_json" | tr -d '[:space:]')

  if printf '%s' "$compact_release_json" | grep -Fq '"message":"NotFound"'; then
    return 1
  fi

  printf '%s' "$compact_release_json" |
    grep -o '"assets_url":"[^"]*"' |
    sed -E 's/"assets_url":"([^"]*)"/\1/'
}

repo_toolkit_release_has_asset() {
  local assets_url="$1"
  local filename="$2"
  local assets_json
  local compact_assets_json

  if [ -z "$assets_url" ]; then
    return 1
  fi

  assets_json=$(repo_toolkit_api_get "$assets_url")
  compact_assets_json=$(printf '%s' "$assets_json" | tr -d '[:space:]')
  printf '%s' "$compact_assets_json" | grep -Fq "\"name\":\"${filename}\""
}

repo_toolkit_resolve_github_coordinates() {
  local script_dir="$1"
  local plugin_root

  if [ -d "${script_dir}/.git" ] || [ -f "${script_dir}/.git" ]; then
    plugin_root="$script_dir"
  else
    plugin_root="$(dirname "$script_dir")"
  fi

  local url
  url=$(git -C "$plugin_root" config --get remote.origin.url 2>/dev/null || true)

  if [ -z "$url" ]; then
    echo "Error: unable to determine GitHub repository (set REPO_TOOLKIT_GITHUB_REPOSITORY)." >&2
    return 1
  fi

  url="${url#git@github.com:}"
  url="${url#https://github.com/}"
  url="${url#ssh://git@github.com/}"
  url="${url%.git}"

  printf '%s\n' "$url"
}
