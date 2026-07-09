#!/usr/bin/env bash

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
