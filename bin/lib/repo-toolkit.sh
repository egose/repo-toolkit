#!/usr/bin/env bash

repo_toolkit_require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq is required by the ${tool_name:-repo-toolkit} asdf plugin." >&2
    echo "Install jq (https://stedolan.github.io/jq/) and ensure it is on PATH." >&2
    return 1
  fi
}

# Fetch a URL, passing the GitHub token via a header read from the process
# stdin (not argv) so it never appears in `ps`/`ps aux` listings.
repo_toolkit_api_get() {
  local url="$1"

  if [ -n "${GITHUB_API_TOKEN:-}${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]; then
    local token="${GITHUB_API_TOKEN:-${GH_TOKEN:-${GITHUB_TOKEN}}}"
    printf 'Authorization: Bearer %s\n' "$token" | curl -s -H @- "$url"
    return
  fi

  curl -s "$url"
}

# Fetch every release page and concatenate into a single JSON array printed to
# stdout. Stops at the first empty page or non-array (error) response.
repo_toolkit_fetch_releases() {
  local github_coordinates="$1"
  local releases_url="https://api.github.com/repos/${github_coordinates}/releases"
  local page
  local response
  local pages=""

  repo_toolkit_require_jq || return 1

  for page in {1..10}; do
    response=$(repo_toolkit_api_get "${releases_url}?per_page=100&page=${page}")

    if printf '%s' "$response" | jq -e 'type == "array" and length == 0' >/dev/null 2>&1; then
      break
    fi

    if ! printf '%s' "$response" | jq -e 'type == "array"' >/dev/null 2>&1; then
      local message
      message=$(printf '%s' "$response" | jq -r '.message // "unexpected response"' 2>/dev/null || echo 'unexpected response')
      echo "Error: GitHub releases request failed: ${message}" >&2
      return 1
    fi

    pages="${pages}${response}
"
  done

  printf '%s' "$pages" | jq -s 'add'
}

# Print true (0) if a release for the given version tag publishes the expected
# asset filename, using a single releases response fetched by the caller.
repo_toolkit_release_has_asset() {
  local releases_json="$1"
  local version="$2"
  local asset_filename="$3"
  local tag="v${version}"

  printf '%s' "$releases_json" | jq -e --arg tag "$tag" --arg name "$asset_filename" '
    any(.[]; .tag_name == $tag and any(.assets[]?; .name == $name))
  ' >/dev/null 2>&1
}

# Print true (0) if a release exists for the given version tag.
repo_toolkit_release_exists() {
  local releases_json="$1"
  local version="$2"
  local tag="v${version}"

  printf '%s' "$releases_json" | jq -e --arg tag "$tag" 'any(.[]; .tag_name == $tag)' >/dev/null 2>&1
}

# Print every release tag (without the leading "v") whose release publishes an
# asset whose name matches the given regex, sorted with `sort -V`.
repo_toolkit_list_installable_versions() {
  local releases_json="$1"
  local asset_regex="$2"

  printf '%s' "$releases_json" | jq -r --arg regex "$asset_regex" '
    .[]
    | select(any(.assets[]?; (.name // "") | test($regex)))
    | .tag_name
    | ltrimstr("v")
  ' 2>/dev/null | sort -V
}

# Resolve the GitHub <owner>/<repo> for this plugin from the local git remote
# of the checked-out plugin source (falling back to REPO_TOOLKIT_GITHUB_REPOSITORY).
repo_toolkit_resolve_github_coordinates() {
  local script_dir="$1"

  if [ -n "${REPO_TOOLKIT_GITHUB_REPOSITORY:-}" ]; then
    printf '%s\n' "$REPO_TOOLKIT_GITHUB_REPOSITORY"
    return
  fi

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
