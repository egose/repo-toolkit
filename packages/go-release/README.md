# `@repo-toolkit/go-release`

Build, archive, checksum, and verify deterministic cross-platform Go binary releases. The package supports one or more binaries per target and regular additional files such as `LICENSE`.

Requires Node.js 20 or newer, a Go compiler for builds, and GNU-compatible `tar` for archive creation and extraction. Verification parses and validates gzip/ustar metadata before invoking `tar` to extract.

## Installation

```sh
pnpm add -D @repo-toolkit/go-release
```

## CLI

Put the binary and target matrix in `go-release.json`, then run:

```sh
repo-toolkit-build-go-release --config go-release.json --version 1.2.3
repo-toolkit-verify-go-release --config go-release.json
```

Build options:

| Option                     | Purpose                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `--config <path>`          | Load JSON, `.mjs`, or `.cjs` configuration.                         |
| `--cwd <path>`             | Locate relative config and set the project root.                    |
| `--tool-name <name>`       | Override `toolName`.                                                |
| `--version <version>`      | Override `version`.                                                 |
| `--output-dir <path>`      | Override `outputDir`.                                               |
| `--go-executable <path>`   | Override `goExecutable`.                                            |
| `--tar-executable <path>`  | Override `tarExecutable`.                                           |
| `--target <os-arch>[,...]` | Build only named configured targets; repeatable.                    |
| `--concurrency <count>`    | Override `processLimits.concurrency`.                               |
| `--dry-run`                | Validate and print the resolved plan without mutation or processes. |
| `--help`                   | Show CLI help.                                                      |

Verify options:

| Option                         | Purpose                                                             |
| ------------------------------ | ------------------------------------------------------------------- |
| `--config <path>`              | Load JSON, `.mjs`, or `.cjs` configuration.                         |
| `--cwd <path>`                 | Locate relative config and set the project root.                    |
| `--tool-name <name>`           | Override `toolName`.                                                |
| `--version <version>`          | Override `version`.                                                 |
| `--output-dir <path>`          | Override `outputDir`.                                               |
| `--go-executable <path>`       | Override the Go executable used by reproducibility checks.          |
| `--tar-executable <path>`      | Override `tarExecutable`.                                           |
| `--concurrency <count>`        | Override concurrency for reproducibility builds.                    |
| `--max-member-count <count>`   | Lower the archive member limit.                                     |
| `--max-path-length <bytes>`    | Lower the archive member path limit.                                |
| `--max-expanded-bytes <bytes>` | Lower the expanded archive size limit.                              |
| `--reproducibility`            | Build twice in temporary roots and compare archives.                |
| `--dry-run`                    | Validate and print the resolved plan without mutation or processes. |
| `--help`                       | Show CLI help.                                                      |

Configuration supplies defaults; explicitly supplied CLI flags override the corresponding values. `--target` filters the build matrix. The build command replaces the complete managed output directory only after every selected binary succeeds, then writes each archive and the checksum manifest through temporary files. CLI configuration cannot inject a library `runner`.

## Library

The ESM API exports `resolveGoReleasePlan`, `buildGoRelease`, `createGoReleaseArchives`, `writeGoReleaseChecksums`, `verifyGoRelease`, `verifyGoReleaseReproducibility`, and an injectable bounded runner. Each operation accepts the same validated release options; verifier limits and reproducibility target subsets are operation-specific extensions.

The full guide in `website/docs/packages/go-release.md` covers tested single- and multi-binary configurations, defaults, archive and checksum contracts, atomicity boundaries, migration caveats, and CI examples.
