---
sidebar_label: Go Release
sidebar_position: 6
---

# `@repo-toolkit/go-release`

`@repo-toolkit/go-release` builds an explicit `GOOS`/`GOARCH` matrix, creates deterministic `tar.gz` files, writes SHA-256 checksums, and verifies release output before publication. It supports the single-binary shape used by `aiproxy` and `s3proxy` and the multi-binary-plus-license shape used by `database-tools`.

The package does not infer products or targets. The repository owns binary package paths, target matrices, version text, archive names, and additional files.

## Requirements

- Node.js 20 or newer.
- A Go executable for build and reproducibility operations. Verification without `--reproducibility` does not invoke Go.
- GNU tar or a compatible implementation. Creation requires `--create`, `--format=ustar`, `--sort=name`, `--mtime=@<epoch>`, `--owner`, `--group`, `--numeric-owner`, `--no-recursion`, and `--file`. Extraction requires `--extract`, `--gzip`, `--file`, `--directory`, `--no-same-owner`, `--same-permissions`, and `--no-overwrite-dir`.
- A filesystem where temporary files can be renamed within the output directory and temporary directories can be renamed from a sibling location into the output path.

GNU tar is an external runtime assumption, not an npm dependency. BSD tar commonly lacks the creation flags above. The package uses Node's zlib implementation for deterministic gzip compression, but still uses configured `tarExecutable` for ustar creation and extraction. Unsupported tar behavior fails the operation; there is no portable fallback.

## Install

```sh
pnpm add -D @repo-toolkit/go-release
```

## Tested Configurations

These JSON examples are compared byte-for-byte as parsed objects with fixtures in the package test suite, then built and verified through both CLIs with a controlled fake Go compiler. The archive path uses GNU tar exactly as production does.

### Single Binary

This models the `aiproxy` layout. It also models `s3proxy` by changing `toolName`, binary name/package, and its version linker value and expected output. Add the remaining repository-supported targets to `targets` as needed.

<!-- example:single-binary -->

```json
{
  "toolName": "aiproxy",
  "version": "1.2.3",
  "outputDir": "dist",
  "binaries": [
    {
      "name": "aiproxy",
      "package": "cmd/aiproxy",
      "linkerValues": [
        {
          "symbol": "main.version",
          "value": "{version}/{os}-{arch}"
        }
      ],
      "versionCommand": {
        "args": ["version"],
        "expectedOutput": "{version}/{os}-{arch}\n",
        "match": "exact"
      }
    }
  ],
  "targets": [
    { "os": "linux", "arch": "amd64" },
    { "os": "darwin", "arch": "arm64" },
    { "os": "windows", "arch": "amd64" }
  ],
  "linkerFlags": ["-buildid=", "-s", "-w"],
  "checksumFile": "checksums.txt",
  "sourceDateEpoch": 0,
  "processLimits": {
    "timeoutMs": 120000,
    "maxOutputBytes": 1048576,
    "concurrency": 2
  }
}
```

The result contains target build directories, one archive per target, and the configured manifest:

```text
dist/
  darwin-arm64/aiproxy
  linux-amd64/aiproxy
  windows-amd64/aiproxy.exe
  aiproxy-darwin-arm64.tar.gz
  aiproxy-linux-amd64.tar.gz
  aiproxy-windows-amd64.tar.gz
  checksums.txt
```

### Multiple Binaries And A License

This models the `database-tools` layout. Each target archive contains both executables and `LICENSE`; Windows binary names receive `.exe` automatically.

<!-- example:multi-binary-license -->

```json
{
  "toolName": "database-tools",
  "version": "1.2.3",
  "outputDir": "dist",
  "binaries": [
    {
      "name": "mongo-archive",
      "package": "mongoarchive/main/mongoarchive.go",
      "linkerValues": [
        {
          "symbol": "main.version",
          "value": "{version} {os}-{arch}"
        }
      ],
      "versionCommand": {
        "args": ["--version"],
        "expectedOutput": "mongo-archive version: {version} {os}-{arch}\n"
      }
    },
    {
      "name": "mongo-unarchive",
      "package": "mongounarchive/main/mongounarchive.go",
      "linkerValues": [
        {
          "symbol": "main.version",
          "value": "{version} {os}-{arch}"
        }
      ],
      "versionCommand": {
        "args": ["--version"],
        "expectedOutput": "mongo-unarchive version: {version} {os}-{arch}\n"
      }
    }
  ],
  "targets": [
    { "os": "linux", "arch": "amd64" },
    { "os": "linux", "arch": "arm64" },
    { "os": "windows", "arch": "amd64" }
  ],
  "additionalFiles": [{ "source": "LICENSE", "destination": "LICENSE" }]
}
```

## Configuration

The CLI loads JSON directly. An `.mjs` file must default-export an object; a `.cjs` module may export the object through `module.exports`. JavaScript configuration is useful when a repository must derive a static field such as `checksumFile`, but configuration is executable code and should be treated as trusted repository input.

All unknown top-level and nested keys are rejected. Relative paths are rooted at `cwd`, normalized, and must remain inside the project. The complete plan is validated before output is created or replaced. `runner` is available only to library callers and is not accepted from serializable configuration.

| Field                          | Required/default               | Contract                                                                                                                 |
| ------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `toolName`                     | Required                       | Safe filename used by the default archive template.                                                                      |
| `version`                      | Required                       | Nonempty filename-safe value; no SemVer normalization or leading-`v` policy is applied.                                  |
| `cwd`                          | Current working directory      | Existing project root. `--cwd` also controls resolution of a relative config path.                                       |
| `outputDir`                    | `dist`                         | Relative managed directory below `cwd`; cannot be the project root.                                                      |
| `goExecutable`                 | `go`                           | Executable or path passed directly to the process runner.                                                                |
| `tarExecutable`                | `tar`                          | GNU-compatible tar executable or path.                                                                                   |
| `binaries`                     | Required, nonempty             | Unique output `name`, relative Go `package`, optional linker values and version command.                                 |
| `targets`                      | Required, nonempty             | Unique lowercase `{ os, arch }` pairs. The package validates token syntax, not whether the Go toolchain supports a pair. |
| `buildFlags`                   | `[-trimpath, -buildvcs=false]` | Arguments placed after `go build`.                                                                                       |
| `linkerFlags`                  | `[-buildid=]`                  | Values combined into one `-ldflags` argument before binary-specific `-X` assignments.                                    |
| `archiveName`                  | `{tool}-{os}-{arch}.tar.gz`    | Safe filename template; generated names must be unique and end in `.tar.gz`.                                             |
| `checksumFile`                 | `SHA256SUMS`                   | Safe literal filename. Template tokens are not expanded here.                                                            |
| `additionalFiles`              | `[]`                           | Existing non-symlink regular source files outside `outputDir`, each mapped to a unique relative archive destination.     |
| `sourceDateEpoch`              | `0`                            | Non-negative integer used for every tar member modification time.                                                        |
| `processLimits.timeoutMs`      | `120000`                       | Positive timeout passed to each Go and tar invocation and each version command.                                          |
| `processLimits.maxOutputBytes` | `1048576`                      | Positive bound for captured or piped child output, including Go build and tar diagnostics.                               |
| `processLimits.concurrency`    | `2`                            | Positive maximum number of target builds in flight. Binaries within one target build serially.                           |

The supported template tokens are `{tool}`, `{version}`, `{os}`, and `{arch}`. They are expanded in `archiveName`, linker values, version-command arguments, and expected version output. A linker value rejects quotes, backslashes, NULs, and line breaks because the implementation must represent it safely in the single Go `-ldflags` argument.

`versionCommand.match` defaults to `exact`, which compares all captured stdout including its trailing newline. `anchored` means the expected text must equal one complete output line; it is not a regular expression. Version commands run only for targets matching the verifier host OS and architecture. Incompatible cross-compiled binaries are never executed.

### Verification Limits

`verifyGoRelease` accepts `archiveLimits`; the verify CLI accepts the same object in its config and allows individual CLI overrides. Defaults are also hard maximums, so callers may lower but not raise them:

| Field              | Default and maximum           |
| ------------------ | ----------------------------- |
| `maxMemberCount`   | `1024`                        |
| `maxPathLength`    | `512` bytes                   |
| `maxExpandedBytes` | `536870912` bytes per archive |

A config containing `archiveLimits` is verifier-specific and is rejected by the build CLI. To share one config between build and verify, omit `archiveLimits` and use verify CLI flags, or keep a separate verifier config.

### Precedence

Configuration values are loaded first. Explicit CLI values then override `cwd`, `toolName`, `version`, `outputDir`, executable paths, and concurrency. Verify limit flags override individual `archiveLimits` fields. Finally, omitted values receive the built-in defaults above.

`--target` is a repeatable, comma-aware build-only filter over configured names such as `linux-amd64`; it does not add targets. A filtered build replaces the managed directory with only that subset. Verification always checks every target in its resolved config. The library-only `targetSubset` option can limit independent reproducibility checks; full-plan comparison is the default.

## CLI

Inspect the authoritative option lists with:

```sh
repo-toolkit-build-go-release --help
repo-toolkit-verify-go-release --help
```

Build all configured targets and override the repository's placeholder version:

```sh
repo-toolkit-build-go-release --config go-release.json --version 1.2.3
```

Resolve and print a deterministic, secrets-free summary without creating output or running Go or tar:

```sh
repo-toolkit-build-go-release --config go-release.json --target linux-amd64 --dry-run
```

Verify existing archives and their checksum manifest:

```sh
repo-toolkit-verify-go-release --config go-release.json
```

Also perform two clean, independent builds and compare archive names, sizes, and SHA-256 digests:

```sh
repo-toolkit-verify-go-release --config go-release.json --reproducibility
```

The build command performs build, archive, and checksum phases. The verify command validates existing output; it rebuilds only when `--reproducibility` is present. Both commands print JSON summaries and return nonzero on validation, process, archive, checksum, or reproducibility failure.

## Library API

```ts
import {
  buildGoRelease,
  createGoReleaseArchives,
  verifyGoRelease,
  verifyGoReleaseReproducibility,
  writeGoReleaseChecksums,
} from '@repo-toolkit/go-release';

await buildGoRelease(options);
await createGoReleaseArchives(options);
await verifyGoRelease(options);
await verifyGoReleaseReproducibility(options);
writeGoReleaseChecksums(options);
```

| API                                       | Responsibility                                                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveGoReleasePlan(options)`           | Runtime-validate and resolve the complete readonly plan without invoking processes or mutating output. It does inspect project paths and additional files.            |
| `buildGoRelease(options)`                 | Cross-compile every configured binary and replace the managed build tree.                                                                                             |
| `createGoReleaseArchives(options)`        | Create each target archive from an already completed build tree, then write the checksum manifest.                                                                    |
| `writeGoReleaseChecksums(options)`        | Recompute the manifest for the exact configured archive set without rebuilding archives.                                                                              |
| `verifyGoRelease(options)`                | Check the manifest, validate archive headers and exact member sets, extract into temporary storage, validate the extracted tree, and run compatible version commands. |
| `verifyGoReleaseReproducibility(options)` | Produce and verify two releases in independent temporary roots and compare exact archive sets, sizes, and hashes without touching normal output.                      |

Library callers can inject a `GoReleaseRunner` with structured `run(executable, args, options)` and `capture(...)` methods. CLI-loaded configuration cannot inject a runner. There is no shell-string API. The default runner merges explicit environment overrides with the parent environment, applies timeout and captured-output limits, and reports the executable without printing inherited environment values. Tar operations clear ambient `TAR_OPTIONS` so inherited flags cannot alter creation or extraction.

## Artifact Contract

Each target gets one gzip-compressed strict ustar archive. Its members are exactly the target's binary names plus configured additional destinations. Non-Windows binaries are mode `0755`; Windows binaries and additional files are mode `0644`. Members are sorted, have modification time `sourceDateEpoch`, numeric uid/gid `0`, and deterministic gzip metadata. Reproducibility still depends on deterministic Go compiler inputs and a compatible tar implementation.

The checksum manifest contains exactly one entry per configured archive, sorted by archive filename. Every line is lowercase SHA-256, two ASCII spaces, the basename, and LF:

```text
0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  aiproxy-linux-amd64.tar.gz
```

The verifier requires both the output directory's `.tar.gz` names and the manifest's names to equal the planned archive set, and rejects malformed hashes, alternate separators, duplicate or unsafe names, missing entries, additional entries, and digest mismatches. Before copying or extraction it bounds manifest, compressed, and expanded data and rejects traversal, absolute or non-normalized paths, duplicate paths, nonzero tar padding, links, devices, FIFOs, sparse files, unsupported types, wrong modes, and unexpected members. It then validates extracted containment, types, sizes, permissions, and nonempty binaries.

## Atomicity And Managed Output

`outputDir` is package-managed. A build stages the complete selected matrix in a temporary sibling and validates every expected binary before replacement. A failed build preserves the prior managed output and cleans staging. A successful build replaces the entire directory, so do not store coverage, SBOMs, signatures, or unrelated files there before building.

Archive creation stages members separately and writes each tarball to a temporary sibling before rename. The checksum manifest is also replaced through a temporary sibling. These are per-file guarantees, not a transaction across all archives and the manifest: a later archive failure can occur after earlier archives were published. Build output remains available when archive or checksum creation fails. OS or process crashes are outside the operation-level rollback guarantee.

Verification snapshots archives into package-owned temporary storage before parsing and extraction and always removes that storage. Reproducibility uses two temporary roots under `cwd`, leaves normal `outputDir` untouched, and removes both roots on success or failure.

## Thin Consumers

A Makefile should delegate release mechanics rather than duplicate them:

```makefile
VERSION ?= dev

.PHONY: release-build release-verify
release-build:
	pnpm exec repo-toolkit-build-go-release --config go-release.json --version "$(VERSION)"

release-verify:
	pnpm exec repo-toolkit-verify-go-release --config go-release.json --version "$(VERSION)" --reproducibility
```

A GitHub Actions job can consume the verified output and leave publication concerns to separate steps:

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 20
- uses: pnpm/action-setup@v4
- uses: actions/setup-go@v5
  with:
    go-version-file: go.mod
- run: pnpm install --frozen-lockfile
- name: Build and verify release archives
  env:
    VERSION: ${{ github.ref_name }}
  run: |
    pnpm exec repo-toolkit-build-go-release --config go-release.json --version "$VERSION"
    pnpm exec repo-toolkit-verify-go-release --config go-release.json --version "$VERSION" --reproducibility
- uses: actions/upload-artifact@v4
  with:
    name: release-${{ github.ref_name }}
    path: |
      dist/*.tar.gz
      dist/SHA256SUMS
```

Ubuntu runners provide GNU tar. If a job uses another operating system or container, install GNU tar and set `tarExecutable` or `--tar-executable` to its actual path. Tag validation, source-SHA validation, tests, vulnerability checks, SBOM generation, signing, provenance, image publication, GitHub Release creation, and asset upload policy remain separate workflow responsibilities.

## Migration Notes

- Decide whether `version` includes a leading `v`; the package preserves the value exactly. The reference repositories currently differ in whether workflows strip it.
- Match each program's real version output. `aiproxy` and `s3proxy` print only their injected value, while the two `database-tools` binaries prefix it differently. Exact matching includes the final newline.
- The default archive is `{tool}-{os}-{arch}.tar.gz` and does not include `version`. Override `archiveName` if an existing release does. All generated names must remain unique.
- The default checksum name is `SHA256SUMS`. `aiproxy` currently uses `checksums.txt`, while `database-tools` uses a versioned `.txt` name. `checksumFile` is literal and has no template expansion; use a fixed compatibility name or trusted JavaScript config that computes it before planning.
- Existing archives may include `./` prefixes or differing modes. This package emits normalized member names and strict modes and will reject legacy layouts that do not exactly match the plan.
- A successful build replaces all of `outputDir`. Move unrelated outputs elsewhere and generate SBOMs or signatures only after the release build.
- A `--target` build publishes only the selected subset. Do not use a partial local build as the input to a verifier configured for the full release matrix.
- The package sets `CGO_ENABLED=0`. Releases requiring CGO or platform-native toolchains are outside this contract.

## Non-Goals

The package does not create or push tags, validate tag/SHA/version-file consistency, create GitHub Releases, upload assets, generate SBOMs, signatures, attestations, or provenance, publish container images, run arbitrary test/lint/integration/deployment pipelines, apply vulnerability policy, parse application configuration, or generate asdf plugins. Consumer repository migration is separate work.
