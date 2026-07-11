# `@repo-toolkit/release-artifact`

Assemble, verify, and distribute a self-contained CLI release artifact (tarball)
from a monorepo.

## Installation

```sh
pnpm add -D @repo-toolkit/release-artifact
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

Useful flags:

Build:

- `--config <path>` Config file (JSON, `.mjs`, or `.cjs` default export). CLI flags override config values.
- `--cwd <path>` Workspace root directory (default: `process.cwd()`).
- `--version <version>` Target version (required). A leading `v` is stripped.
- `--tag <version>` Compatibility alias for `--version`.
- `--tool-name <name>` Tool name used in artifact filenames (default: `repo-toolkit`).
- `--version-files <f>[,<f>]` Root file(s) copied into artifact root (default: `VERSION`).
- `--root-files <f>[,<f>]` Additional root files copied into artifact root.
- `--packages-dir <path>` Directory holding packages (default: `packages`).
- `--dist-dir <path>` Directory where the tarball is written (default: `dist`).
- `--skip-node-modules` Do not copy `node_modules` into the artifact.
- `--node-command <name>` Node interpreter used in bash wrappers (default: `node`).

Verify:

- `--config <path>` Config file (JSON, `.mjs`, or `.cjs` default export).
- `--cwd <path>` Workspace root directory (default: `process.cwd()`).
- `--version <version>` Target version used to locate the tarball (required unless `--artifact-path` is set).
- `--tag <version>` Compatibility alias for `--version`.
- `--tool-name <name>` Tool name used to locate the tarball (default: `repo-toolkit`).
- `--dist-dir <path>` Directory holding the tarball (default: `dist`).
- `--artifact-path <path>` Explicit tarball path; overrides cwd/tool-name/dist-dir resolution.
- `--help-flag <flag>` Flag passed to each wrapper to confirm it boots (default: `--help`).

## JavaScript API

```ts
import { buildReleaseArtifact, verifyReleaseArtifact } from '@repo-toolkit/release-artifact';

const plan = buildReleaseArtifact({
  version: '1.2.3',
  cwd: '/path/to/monorepo',
  includeNodeModules: true,
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
- `buildRequiredFiles(commands, versionFiles)` — compute the manifest's `requiredFiles` list.
- `createArtifactManifest(version, commands, requiredFiles)` — assemble the manifest (commands sorted).
- `verifySymlinks(rootPath, currentPath?)` — throw on any absolute symlink.

### Options

- `version` _(string, required)_ Target version. A leading `v` is stripped.
- `cwd` _(string)_ Workspace root directory. Defaults to `process.cwd()`.
- `toolName` _(string)_ Tool name used in artifact filenames (default: `repo-toolkit`).
- `versionFiles` _(string[])_ Root file(s) copied into artifact root (default: `['VERSION']`). Missing files are skipped.
- `rootFiles` _(string[])_ Additional root files copied into artifact root. Missing files are skipped.
- `packagesDir` _(string)_ Directory holding packages (default: `packages`).
- `distDir` _(string)_ Directory where the tarball is written / located (default: `dist`).
- `includeNodeModules` _(boolean)_ Copy `node_modules` into the artifact (default: `true`).
- `nodeCommand` _(string)_ Node interpreter used in bash wrappers (default: `node`).
- `artifactPath` _(string, verify only)_ Explicit tarball path; overrides cwd/tool-name/dist-dir resolution.
- `helpFlag` _(string, verify only)_ Flag passed to each wrapper to confirm it boots (default: `--help`).

## Security note

`verifyReleaseArtifact` executes the artifact's bash wrappers, which in turn
`exec` the node interpreter against the artifact's own entry files. Only verify
artifacts you trust — verification is an integrity check, not a sandbox.

## Docs

The longer guide lives in the workspace documentation site under
`website/docs/packages/release-artifact.md`.
