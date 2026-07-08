---
sidebar_label: Publish Packages
sidebar_position: 3
---

# `@repo-toolkit/publish-packages`

Build, stage, and publish every package in a monorepo to npm in dependency order.

`publish-packages` is the workspace wrapper around
[`@repo-toolkit/publish-package`](./publish-package). It discovers packages under
`packages/*`, sorts them by internal dependency order, filters the selection,
and then calls the single-package publish engine for each package.

## Install

```bash npm2yarn
npm install --save-dev @repo-toolkit/publish-packages
```

## CLI

```sh
repo-toolkit-publish-packages --version v1.2.3
```

`--tag` is still accepted as a compatibility alias, but `--version` is the
preferred spelling.

### Flags

| Flag                              | Description                                                                                                  | Default                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `--config <path>`                 | Config file with publish options (JSON, `.mjs`, or `.cjs` default export). CLI flags override config values. | —                                           |
| `--cwd <path>`                    | Workspace root directory                                                                                     | `process.cwd()`                             |
| `--version <version>`             | Target version for every selected package. A leading `v` is stripped.                                        | —                                           |
| `--tag <version>`                 | Compatibility alias for `--version`                                                                          | —                                           |
| `--npm-tag <dist-tag>`            | npm dist-tag                                                                                                 | inferred from the prerelease `preid`        |
| `--filter <name>[,<name>]`        | Only publish matching packages (by name or directory). Applied before `--from`.                              | —                                           |
| `--from <name>`                   | Start publishing from the first package matching this selector, computed against the post-`--filter` list.   | —                                           |
| `--package-files <file>[,<file>]` | Files copied from each package root into the publish dir (replaces defaults).                                | `['README.md', 'CHANGELOG.md', 'llms.txt']` |
| `--include-package-file <path>`   | Additional file copied from each package root (repeatable, additive).                                        | —                                           |
| `--no-default-package-files`      | Skip copying default package files.                                                                          | `false`                                     |
| `--root-files <file>[,<file>]`    | Files copied from the workspace root into each publish dir (replaces defaults).                              | `['LICENSE']`                               |
| `--include-root-file <path>`      | Additional file copied from the workspace root (repeatable, additive).                                       | —                                           |
| `--no-default-root-files`         | Skip copying default root files.                                                                             | `false`                                     |
| `--publish-dir <path>`            | Publish directory inside each package.                                                                       | `dist`                                      |
| `--version-placeholder <text>`    | Placeholder rewritten to the target version.                                                                 | `0.0.0-PLACEHOLDER`                         |
| `--build-command <command>`       | Command used to build each publish dir.                                                                      | `pnpm build`                                |
| `--skip-build`                    | Skip the build step                                                                                          | `false`                                     |
| `--access <level>`                | npm publish access level                                                                                     | `public`                                    |
| `--registry <url>`                | npm registry URL                                                                                             | —                                           |
| `--otp <code>`                    | npm OTP code                                                                                                 | —                                           |
| `--provenance`                    | Request npm provenance attestation                                                                           | `false`                                     |
| `--dry-run`                       | Forward `--dry-run` to `npm publish`.                                                                        | `false`                                     |
| `-h, --help`                      | Show help                                                                                                    | —                                           |

## Config File

```js
/** @type {import('@repo-toolkit/publish-packages').PublishPackagesOptions} */
export default {
  version: '1.2.3',
  filters: ['changelog'],
  rootFiles: ['LICENSE', 'NOTICE'],
  publishDir: 'dist',
  versionPlaceholder: '0.0.0-PLACEHOLDER',
  buildCommand: 'pnpm build',
  dryRun: true,
};
```

```sh
repo-toolkit-publish-packages --config publish-packages.config.mjs
```

## JavaScript API

```ts
import { publishPackages } from '@repo-toolkit/publish-packages';

publishPackages({
  version: '1.2.3',
  cwd: '/path/to/monorepo',
  filters: ['changelog'],
  rootFiles: ['LICENSE', 'NOTICE'],
  publishDir: 'dist',
  versionPlaceholder: '0.0.0-PLACEHOLDER',
  dryRun: true,
});
```

### Exports

- `sortPackagesByInternalDependencies(...)` — topologically sort internal packages (throws on cycles).
- `resolvePublishPackagesPlan(options)` — resolve the selected package list and shared publish options without publishing.
- `publishPackages(options)` — run the full workspace publish pipeline.
- `inferNpmTag(version)` — derive the npm dist-tag from a version string.

For generic single-package manifest rewriting and npm publish plumbing, use
[`@repo-toolkit/publish-package`](./publish-package).
