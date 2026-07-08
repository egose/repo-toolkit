---
sidebar_label: CLI
sidebar_position: 2
---

# CLI

The `repo-toolkit-changelog` binary reads git metadata from the current directory and writes `CHANGELOG.md` (by default) prepended with the new release entry.

## Usage

```sh
repo-toolkit-changelog [options]
```

## Flags

| Flag                       | Description                                             | Default         |
| -------------------------- | ------------------------------------------------------- | --------------- |
| `--config <path>`          | Config file with changelog options such as custom types | —               |
| `--cwd <path>`             | Working directory to read package and git metadata from | `process.cwd()` |
| `--output <path>`          | Output file path                                        | `CHANGELOG.md`  |
| `--tag-prefix <prefix>`    | Tag prefix to match                                     | `v`             |
| `--release-count <number>` | Number of releases to include                           | `0` (all)       |
| `--append`                 | Append to the output instead of prepending              | `false`         |
| `--first-release`          | Include all commits when no prior release tag exists    | `false`         |
| `--no-skip-unstable`       | Include unstable releases                               | (skipped)       |
| `--no-output-unreleased`   | Omit the unreleased section                             | (included)      |
| `-h, --help`               | Show help                                               | —               |

## Examples

Generate the full changelog:

```sh
repo-toolkit-changelog
```

Generate into a custom file and only include the last 3 releases:

```sh
repo-toolkit-changelog --output HISTORY.md --release-count 3
```

Use a custom tag prefix (e.g. `release-1.2.3`):

```sh
repo-toolkit-changelog --tag-prefix release-
```

See [Config File](./config) for `--config` usage. CLI flags override values from the config file.
