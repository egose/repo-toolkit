---
sidebar_label: Release Artifact
sidebar_position: 4
---

# `@repo-toolkit/release-artifact`

Assemble, verify, and distribute a self-contained CLI release artifact (tarball)
from a monorepo.

`release-artifact` discovers packages under `packages/*`, generates bash wrappers
for each `bin` entry, copies the workspace `node_modules` (optional), writes an
`artifact-manifest.json`, and packages everything into a `<toolName>-<version>.tar.gz`.
Verification re-extracts the tarball and checks required files, symlink safety,
and that each wrapper boots (`<wrapper> --help`).

The asdf plugin in this repo consumes the resulting tarball directly, but the
package is generic: any monorepo that wants to ship a bundled CLI artifact can
use it.

## Install

```bash npm2yarn
npm install --save-dev @repo-toolkit/release-artifact
```

## CLI

### Build

```sh
repo-toolkit-build-artifact --version v1.2.3
```

### Verify

```sh
repo-toolkit-verify-artifact --version v1.2.3
```

### Flags

| Flag                             | Description                                                                               | Default            |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ------------------ | --- |
| `--config <path>`                | Config file (JSON, `.mjs`, or `.cjs` default export). CLI flags override config.          | —                  |
| `--cwd <path>`                   | Workspace root directory                                                                  | `process.cwd()`    |
| `--version <version>`            | Target version. A leading `v` is stripped.                                                | —                  |
| `--tag <version>`                | Alias for `--version`                                                                     | —                  |
| `--tool-name <name>`             | Tool name used in artifact filenames                                                      | `repo-toolkit`     |
| `--packages-dir <path>`          | Directory under workspace root holding packages (build only)                              | `packages`         |
| `--dist-dir <path>`              | Directory under workspace root where the tarball is written / located                     | `dist`             |
| `--version-files <f>[,<f>]`      | Root file(s) copied into artifact root, preserving subpath (build only)                   | `['VERSION']`      |
| `--root-files <f>[,<f>]`         | Additional root files copied into artifact root, preserving subpath (build only)          | —                  |
| `--node-modules <mode>`          | Resolved node-modules mode: `production`, `copy`, or `none` (build only)                  | `production`       |
| `--skip-node-modules`            | Compatibility alias for `--node-modules none` (build only)                                | —                  |
| `--production-node-modules`      | Compatibility alias for `--node-modules production` (build only)                          | —                  |
| `--no-production-node-modules`   | Compatibility alias for `--node-modules copy                                              | none` (build only) | —   |
| `--node-command <name>`          | Node interpreter used in bash wrappers (build only)                                       | `node`             |
| `--exclude <glob>[,<glob>]`      | Glob patterns excluded from each copied package (replaces defaults; build only)           | `see source`       |
| `--run-timeout-ms <ms>`          | Per-process timeout for external commands                                                 | `60000`            |
| `--max-archive-member-count <n>` | Maximum number of archive members before validation rejects the artifact (verify/install) | `20000`            |
| `--artifact-path <path>`         | Explicit tarball path; overrides cwd/tool-name/dist-dir (verify only)                     | —                  |
| `--help-flag <flag>`             | Flag passed to each wrapper to confirm it boots (verify only)                             | `--help`           |
| `-h, --help`                     | Show help                                                                                 | —                  |

## JavaScript API

### Build

```ts
import { buildReleaseArtifact } from '@repo-toolkit/release-artifact';

const plan = buildReleaseArtifact({
  version: '1.2.3',
  cwd: '/path/to/monorepo',
  toolName: 'repo-toolkit',
  nodeModulesMode: 'production',
  rootFiles: ['LICENSE'],
});

console.log(plan.artifactPath);
```

### Verify

```ts
import { verifyReleaseArtifact } from '@repo-toolkit/release-artifact';

verifyReleaseArtifact({
  version: '1.2.3',
  cwd: '/path/to/monorepo',
  toolName: 'repo-toolkit',
});
```

### Exports

- `buildReleaseArtifact(options)` — assemble the artifact and write the tarball; returns the resolved plan.
- `verifyReleaseArtifact(options)` — extract the tarball and validate manifest, required files, symlink safety, and each wrapper's `--help`.
- `resolveBuildArtifactPlan(options)` — resolve the build plan without writing.
- `resolveArtifactPath(options)` — resolve the expected tarball path for a version.
- `buildWrapperScript(targetPath, nodeCommand?)` — generate a bash wrapper that `exec`s the node interpreter.
- `toBinEntries(binField, packageName)` — normalize a `package.json#bin` field into `[name, entry]` pairs.
- `collectCommands(packagesRoot, packageDirNames)` — read `bin` entries across packages.
- `collectCommandPackageClosure(packagesRoot, packageDirNames, commands)` — compute the transitive closure of command-owning packages.
- `mergeClosureDependencies(packagesRoot, closurePackageDirs)` — merge production deps of closure packages, rejecting incompatible range conflicts.
- `intersectSemverRanges(ranges)` — conservative npm range intersection (rejects when in doubt).
- `resolveNodeModulesMode(mode, includeNodeModules, productionNodeModules)` — resolve the legacy booleans + explicit mode to a single `NodeModulesMode`.
- `resolveRootFileDestination(value, label)` — validate a root/version file's relative POSIX destination.
- `buildRequiredFiles(commands, versionFiles)` — compute the manifest's `requiredFiles` list.
- `createArtifactManifest(version, commands, requiredFiles)` — assemble the manifest (commands sorted).
- `verifySymlinks(rootPath, currentPath?)` — throw on any absolute symlink.
- `validateArtifactRunner(runner)` — assert a value is a valid `ArtifactRunner`.
- `defaultArtifactRunner` — injectable runner that bounds `tar`/`pnpm`/`bash`/wrapper execution with timeout and max-output limits.
- `resolveRunTimeoutMs(value)` — validate the per-process timeout override.
- `resolveMaxArchiveMemberCount(value)` — validate the max archive member count override.

### Options

#### `BuildArtifactOptions`

- `version` _(string, required)_ Target version. A leading `v` is stripped.
- `cwd` _(string)_ Workspace root directory. Defaults to `process.cwd()`.
- `toolName` _(string)_ Tool name used in artifact directory and tarball filenames (default: `repo-toolkit`).
- `versionFiles` _(string[])_ Root file(s) copied into artifact root, preserving the configured subpath (default: `['VERSION']`). Missing files fail the build.
- `rootFiles` _(string[])_ Additional root files copied into artifact root, preserving the configured subpath. Missing files fail the build.
- `packagesDir` _(string)_ Directory under workspace root holding packages (default: `packages`).
- `distDir` _(string)_ Directory under workspace root where the tarball is written (default: `dist`).
- `nodeModulesMode` _(`'production' | 'copy' | 'none'`)_ Resolved node-modules mode (default: `production`). Replaces `includeNodeModules`/`productionNodeModules`; passing both with conflicting values is rejected.
- `includeNodeModules` _(boolean, deprecated)_ Use `nodeModulesMode: 'copy'` (`true`) or `nodeModulesMode: 'none'` (`false`).
- `productionNodeModules` _(boolean, deprecated)_ Use `nodeModulesMode: 'production'` (`true`) or `nodeModulesMode: 'copy'|'none'` (`false`).
- `nodeCommand` _(string)_ Node interpreter used in generated bash wrappers (default: `node`).
- `excludes` _(string[])_ Glob patterns excluded from each copied package directory. Replaces the defaults.
- `runner` _(ArtifactRunner)_ Injectable subprocess runner (default: `defaultArtifactRunner`).
- `runTimeoutMs` _(number)_ Per-process timeout for external commands (default: 60000).

#### `VerifyArtifactOptions`

- `version` _(string, required unless `artifactPath` is set)_ Target version used to locate the tarball.
- `cwd` _(string)_ Workspace root directory. Defaults to `process.cwd()`.
- `toolName` _(string)_ Tool name used to locate the tarball (default: `repo-toolkit`).
- `distDir` _(string)_ Directory under workspace root holding the tarball (default: `dist`).
- `artifactPath` _(string)_ Explicit tarball path; overrides `cwd`/`toolName`/`distDir` resolution.
- `helpFlag` _(string)_ Flag passed to each wrapper to confirm the command boots (default: `--help`).
- `skipExec` _(boolean)_ Skip executing wrappers; only check manifest, required files, symlink safety, x_OK, and `bash -n`.
- `runner` _(ArtifactRunner)_ Injectable subprocess runner (default: `defaultArtifactRunner`).
- `runTimeoutMs` _(number)_ Per-process timeout for external commands (default: 60000).
- `maxArchiveMemberCount` _(number)_ Maximum number of archive members before validation rejects the artifact (default: 20000). Must be a positive finite integer.

### Injectable subprocess runner

`buildReleaseArtifact`, `verifyReleaseArtifact`, `verifyExtractedArtifact`, and
`installReleaseArtifact` accept an injectable `ArtifactRunner` so tests can
assert exact invocations without contacting a real toolchain. The default
runner (`defaultArtifactRunner`) spawns via `execFileSync` with:

- `timeoutMs` (default 60s) — kills the child after the configured window via `SIGTERM`.
- `maxOutputBytes` (default 8 MiB) — bounds the captured output of `runner.capture()`.

`run()` surfaces a nonzero exit or timeout as a thrown `Error`; `capture()`
additionally rejects output larger than `maxOutputBytes`. Tests inject a fake
runner to assert exact `tar`/`pnpm`/`bash`/wrapper invocations offline.

## Security note

`verifyReleaseArtifact` executes the artifact's bash wrappers, which in turn
`exec` the node interpreter against the artifact's own entry files. Only verify
artifacts you trust — verification is an integrity check, not a sandbox.
