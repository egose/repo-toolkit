---
sidebar_label: Publish Package
sidebar_position: 2
---

# `@repo-toolkit/publish-package`

Build, stage, and publish a single package to npm.

This package contains the reusable single-package publish engine that
`@repo-toolkit/publish-packages` builds on top of.

## Install

```bash npm2yarn
npm install --save-dev @repo-toolkit/publish-package
```

## CLI

```sh
repo-toolkit-publish-package
```

When `package.json.version` already contains the real release version, you can
omit `--version`. If `package.json.version` still uses the placeholder, pass
`--version` explicitly.

### Flags

| Flag                              | Description                                                                                                  | Default                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `--config <path>`                 | Config file with publish options (JSON, `.mjs`, or `.cjs` default export). CLI flags override config values. | —                                           |
| `--cwd <path>`                    | Package root directory                                                                                       | `process.cwd()`                             |
| `--root-dir <path>`               | Directory to source `rootFiles` from                                                                         | `cwd`                                       |
| `--package-json <path>`           | Source package.json path                                                                                     | `package.json`                              |
| `--version <version>`             | Target package version. A leading `v` is stripped.                                                           | `package.json.version`                      |
| `--npm-tag <dist-tag>`            | npm dist-tag                                                                                                 | inferred from the prerelease `preid`        |
| `--publish-dir <path>`            | Publish directory inside the package root.                                                                   | `dist`                                      |
| `--version-placeholder <text>`    | Placeholder rewritten to the target version.                                                                 | `0.0.0-PLACEHOLDER`                         |
| `--package-files <file>[,<file>]` | Files copied from the package root into the publish dir.                                                     | `['README.md', 'CHANGELOG.md', 'llms.txt']` |
| `--root-files <file>[,<file>]`    | Files copied from `rootDir` into the publish dir.                                                            | `['LICENSE']`                               |
| `--build-command <command>`       | Command used to build the publish dir.                                                                       | `pnpm build`                                |
| `--skip-build`                    | Skip the build step                                                                                          | `false`                                     |
| `--access <level>`                | npm publish access level                                                                                     | `public`                                    |
| `--registry <url>`                | npm registry URL                                                                                             | —                                           |
| `--otp <code>`                    | npm OTP code                                                                                                 | —                                           |
| `--provenance`                    | Request npm provenance attestation                                                                           | `false`                                     |
| `--dry-run`                       | Forward `--dry-run` to `npm publish`.                                                                        | `false`                                     |
| `-h, --help`                      | Show help                                                                                                    | —                                           |

## Config File

```js
/** @type {import('@repo-toolkit/publish-package').PublishPackageOptions} */
export default {
  cwd: process.cwd(),
  version: '1.2.3',
  rootFiles: ['LICENSE'],
  packageFiles: ['README.md', 'CHANGELOG.md'],
  publishDir: 'dist',
  versionPlaceholder: '0.0.0-PLACEHOLDER',
  buildCommand: 'pnpm build',
  dryRun: true,
};
```

## JavaScript API

```ts
import { publishPackage } from '@repo-toolkit/publish-package';

publishPackage({
  cwd: '/path/to/package',
  version: '1.2.3',
  rootFiles: ['LICENSE'],
  packageFiles: ['README.md', 'CHANGELOG.md'],
  publishDir: 'dist',
  versionPlaceholder: '0.0.0-PLACEHOLDER',
  dryRun: true,
});
```

### Exports

- `createPublishPackageJson(...)` — rewrite a package manifest for publish.
- `resolvePublishPackagePlan(options)` — resolve file/version/publish metadata without publishing.
- `publishPackage(options)` — run the build/copy/npm-publish pipeline for one package.
- `inferNpmTag(version)` — derive the npm dist-tag from a version string.
- `isPlainObject(value)` — shared object guard used by the config loaders and manifest rewriters.

## Relationship to `publish-packages`

Use `publish-package` when you want to publish one package directly. Use
[`@repo-toolkit/publish-packages`](./publish-packages) when you want workspace
package discovery, internal dependency ordering, and package selection via
`--filter` / `--from`.
