# `@repo-toolkit/release-artifact`

Assemble, verify, and distribute a self-contained CLI release artifact (tarball)
from a monorepo.

## Installation

```sh
pnpm add -D @repo-toolkit/release-artifact
```

## CLI

```sh
repo-toolkit-release-artifact build --version v1.2.3
repo-toolkit-release-artifact verify --version v1.2.3
repo-toolkit-release-artifact install --archive-path ./dist/repo-toolkit-v1.2.3.tar.gz --install-path /tmp/install --version v1.2.3
# Standalone aliases remain available:
repo-toolkit-build-artifact --version v1.2.3
repo-toolkit-verify-artifact --version v1.2.3
repo-toolkit-install-artifact --archive-path ./dist/repo-toolkit-v1.2.3.tar.gz --install-path /tmp/install --version v1.2.3
```

Useful flags:

Build:

- `--config <path>` Config file (JSON, `.mjs`, or `.cjs` default export). CLI flags override config values.
- `--cwd <path>` Workspace root directory (default: `process.cwd()`).
- `--version <version>` Target version (required). A leading `v` is stripped.
- `--tag <version>` Compatibility alias for `--version`.
- `--tool-name <name>` Tool name used in artifact filenames (default: `repo-toolkit`).
- `--version-files <f>[,<f>]` Root file(s) copied into artifact root, preserving subpath (default: `VERSION`). Missing files fail the build.
- `--root-files <f>[,<f>]` Additional root files copied into artifact root, preserving subpath. Missing files fail the build.
- `--packages-dir <path>` Directory holding packages (default: `packages`).
- `--dist-dir <path>` Directory where the tarball is written (default: `dist`).
- `--node-modules <mode>` Resolved node-modules mode: `production` (default), `copy`, or `none`.
- `--skip-node-modules` Compatibility alias for `--node-modules none`.
- `--production-node-modules` / `--no-production-node-modules` Compatibility aliases for `--node-modules production` / `copy|none`.
- `--node-command <name>` Node interpreter used in bash wrappers (default: `node`).
- `--run-timeout-ms <ms>` Per-process timeout for external commands (default: 60000).

Verify:

- `--config <path>` Config file (JSON, `.mjs`, or `.cjs` default export).
- `--cwd <path>` Workspace root directory (default: `process.cwd()`).
- `--version <version>` Target version used to locate the tarball (required unless `--artifact-path` is set).
- `--tag <version>` Compatibility alias for `--version`.
- `--tool-name <name>` Tool name used to locate the tarball (default: `repo-toolkit`).
- `--dist-dir <path>` Directory holding the tarball (default: `dist`).
- `--artifact-path <path>` Explicit tarball path; overrides cwd/tool-name/dist-dir resolution.
- `--help-flag <flag>` Flag passed to each wrapper to confirm it boots (default: `--help`).
- `--run-timeout-ms <ms>` Per-process timeout for external commands (default: 60000).
- `--max-archive-member-count <n>` Maximum number of archive members before validation rejects the artifact (default: 20000).

## JavaScript API

```ts
import { buildReleaseArtifact, verifyReleaseArtifact } from '@repo-toolkit/release-artifact';

const plan = buildReleaseArtifact({
  version: '1.2.3',
  cwd: '/path/to/monorepo',
  nodeModulesMode: 'production',
  rootFiles: ['LICENSE'],
});

verifyReleaseArtifact({ version: '1.2.3', cwd: '/path/to/monorepo' });
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
- `validateArtifactRunner(runner)` — assert a value is a valid `ArtifactRunner`.
- `defaultArtifactRunner` — injectable runner that bounds `tar`/`pnpm`/`bash`/wrapper execution with timeout and max-output limits.
- `buildRequiredFiles(commands, versionFiles)` — compute the manifest's `requiredFiles` list.
- `createArtifactManifest(version, commands, requiredFiles)` — assemble the manifest (commands sorted).
- `verifySymlinks(rootPath, currentPath?)` — throw on any absolute symlink.
- `resolveRunTimeoutMs(value)` — validate the per-process timeout override.
- `resolveMaxArchiveMemberCount(value)` — validate the max archive member count override.

### Options (BuildArtifactOptions)

- `version` _(string, required)_ Target version. A leading `v` is stripped.
- `cwd` _(string)_ Workspace root directory. Defaults to `process.cwd()`.
- `toolName` _(string)_ Tool name used in artifact filenames (default: `repo-toolkit`).
- `versionFiles` _(string[])_ Root file(s) copied into artifact root, preserving the configured subpath (default: `['VERSION']`). Missing files fail the build.
- `rootFiles` _(string[])_ Additional root files copied into artifact root, preserving the configured subpath. Missing files fail the build.
- `packagesDir` _(string)_ Directory holding packages (default: `packages`).
- `distDir` _(string)_ Directory where the tarball is written / located (default: `dist`).
- `nodeModulesMode` _(NodeModulesMode)_ Resolved node-modules mode: `'production'` (default), `'copy'`, or `'none'`. Replaces the legacy `includeNodeModules`/`productionNodeModules` booleans; passing both with conflicting values is rejected.
- `includeNodeModules` _(boolean, deprecated)_ Use `nodeModulesMode: 'copy'` (`true`) or `nodeModulesMode: 'none'` (`false`).
- `productionNodeModules` _(boolean, deprecated)_ Use `nodeModulesMode: 'production'` (`true`) or `nodeModulesMode: 'copy'|'none'` (`false`).
- `nodeCommand` _(string)_ Node interpreter used in bash wrappers (default: `node`).
- `excludes` _(string[])_ Glob patterns excluded from each copied package directory. Replaces the defaults.
- `runner` _(ArtifactRunner)_ Injectable subprocess runner. Defaults to `defaultArtifactRunner`.
- `runTimeoutMs` _(number)_ Per-process timeout for external commands (default: 60000). Must be a positive finite number.

### Options (VerifyArtifactOptions / InstallArtifactOptions)

- `version` _(string, required)_ Target version used to locate the tarball (verify) or asserted against the manifest (install). A leading `v` is stripped.
- `cwd` _(string)_ Workspace root directory. Defaults to `process.cwd()`.
- `toolName` _(string)_ Tool name used to locate the tarball (default: `repo-toolkit`).
- `distDir` _(string)_ Directory holding the tarball (default: `dist`).
- `artifactPath` _(string, verify only)_ Explicit tarball path; overrides cwd/tool-name/dist-dir resolution.
- `helpFlag` _(string)_ Flag passed to each wrapper to confirm it boots (default: `--help`).
- `skipExec` _(boolean)_ Skip executing wrappers; only check manifest, required files, symlink safety, x_OK, and `bash -n`.
- `force` _(boolean, install only)_ Replace an existing non-empty install path (default: `false`).
- `runner` _(ArtifactRunner)_ Injectable subprocess runner. Defaults to `defaultArtifactRunner`.
- `runTimeoutMs` _(number)_ Per-process timeout for external commands (default: 60000).
- `maxArchiveMemberCount` _(number)_ Maximum number of archive members before validation rejects the artifact (default: 20000). Must be a positive finite integer.

### Injectable subprocess runner

`buildReleaseArtifact`, `verifyReleaseArtifact`, `verifyExtractedArtifact`, and `installReleaseArtifact` accept an injectable `ArtifactRunner` so tests can assert exact invocations without contacting a real toolchain. The default runner (`defaultArtifactRunner`) spawns via `execFileSync` with:

- `timeoutMs` (default 60s) — kills the child after the configured window via `SIGTERM`.
- `maxOutputBytes` (default 8 MiB) — bounds the captured output of `runner.capture()`.

`run()` surfaces a nonzero exit or timeout as a thrown `Error`; `capture()` additionally rejects output larger than `maxOutputBytes`.

## Security note

`verifyReleaseArtifact` executes the artifact's bash wrappers, which in turn
`exec` the node interpreter against the artifact's own entry files. Only verify
artifacts you trust — verification is an integrity check, not a sandbox.

## Docs

The longer guide lives in the workspace documentation site under
`website/docs/packages/release-artifact.md`.
