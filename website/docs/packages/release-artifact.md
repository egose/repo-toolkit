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

| Flag                        | Description                                                                      | Default         |
| --------------------------- | -------------------------------------------------------------------------------- | --------------- |
| `--config <path>`           | Config file (JSON, `.mjs`, or `.cjs` default export). CLI flags override config. | —               |
| `--cwd <path>`              | Workspace root directory                                                         | `process.cwd()` |
| `--version <version>`       | Target version. A leading `v` is stripped.                                       | —               |
| `--tag <version>`           | Alias for `--version`                                                            | —               |
| `--tool-name <name>`        | Tool name used in artifact filenames                                             | `repo-toolkit`  |
| `--packages-dir <path>`     | Directory under workspace root holding packages (build only)                     | `packages`      |
| `--dist-dir <path>`         | Directory under workspace root where the tarball is written / located            | `dist`          |
| `--version-files <f>[,<f>]` | Root file(s) copied into artifact root (build only)                              | `['VERSION']`   |
| `--root-files <f>[,<f>]`    | Additional root files copied into artifact root (build only)                     | —               |
| `--skip-node-modules`       | Do not copy `node_modules` into the artifact (build only)                        | `false`         |
| `--node-command <name>`     | Node interpreter used in bash wrappers (build only)                              | `node`          |
| `--artifact-path <path>`    | Explicit tarball path; overrides cwd/tool-name/dist-dir (verify only)            | —               |
| `--help-flag <flag>`        | Flag passed to each wrapper to confirm it boots (verify only)                    | `--help`        |
| `-h, --help`                | Show help                                                                        | —               |

## JavaScript API

### Build

```ts
import { buildReleaseArtifact } from '@repo-toolkit/release-artifact';

const plan = buildReleaseArtifact({
  version: '1.2.3',
  cwd: '/path/to/monorepo',
  toolName: 'repo-toolkit',
  includeNodeModules: true,
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
- `buildRequiredFiles(commands, versionFiles)` — compute the manifest's `requiredFiles` list.
- `createArtifactManifest(version, commands, requiredFiles)` — assemble the manifest (commands sorted).
- `verifySymlinks(rootPath, currentPath?)` — throw on any absolute symlink.

### Options

#### `BuildArtifactOptions`

- `version` _(string, required)_ Target version. A leading `v` is stripped.
- `cwd` _(string)_ Workspace root directory. Defaults to `process.cwd()`.
- `toolName` _(string)_ Tool name used in artifact directory and tarball filenames (default: `repo-toolkit`).
- `versionFiles` _(string[])_ Root file(s) copied into artifact root (default: `['VERSION']`). Missing files are skipped.
- `rootFiles` _(string[])_ Additional root files copied into artifact root. Missing files are skipped.
- `packagesDir` _(string)_ Directory under workspace root holding packages (default: `packages`).
- `distDir` _(string)_ Directory under workspace root where the tarball is written (default: `dist`).
- `includeNodeModules` _(boolean)_ Copy `node_modules` into the artifact so commands run without an install (default: `true`).
- `nodeCommand` _(string)_ Node interpreter used in generated bash wrappers (default: `node`).

#### `VerifyArtifactOptions`

- `version` _(string, required unless `artifactPath` is set)_ Target version used to locate the tarball.
- `cwd` _(string)_ Workspace root directory. Defaults to `process.cwd()`.
- `toolName` _(string)_ Tool name used to locate the tarball (default: `repo-toolkit`).
- `distDir` _(string)_ Directory under workspace root holding the tarball (default: `dist`).
- `artifactPath` _(string)_ Explicit tarball path; overrides `cwd`/`toolName`/`distDir` resolution.
- `helpFlag` _(string)_ Flag passed to each wrapper to confirm the command boots (default: `--help`).

## Security note

`verifyReleaseArtifact` executes the artifact's bash wrappers, which in turn
`exec` the node interpreter against the artifact's own entry files. Only verify
artifacts you trust — verification is an integrity check, not a sandbox.
