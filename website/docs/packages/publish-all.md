---
sidebar_label: Publish All
sidebar_position: 2
---

# `@repo-toolkit/publish-all`

Build, stage, and publish every package in a monorepo to npm in dependency order.

## Install

```bash npm2yarn
npm install --save-dev @repo-toolkit/publish-all
```

## CLI

```sh
repo-toolkit-publish-all --tag v1.2.3
```

Run the binary from the monorepo root. The tool locates the root `package.json`,
reads shared metadata (author, bugs, engines, license, repository), then
iterates over every package under `packages/*`, builds it, copies
`README.md` / `llms.txt` from each package and the configured root files
(default `LICENSE`) into the publish directory, rewrites the package manifest
for publish, and runs `npm publish`.

### Flags

| Flag                           | Description                                                                                                  | Default                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `--config <path>`              | Config file with publish options (JSON, `.mjs`, or `.cjs` default export). CLI flags override config values. | —                                    |
| `--cwd <path>`                 | Monorepo root directory                                                                                      | `process.cwd()`                      |
| `--tag <version>`              | Target version (required). A leading `v` is stripped.                                                        | —                                    |
| `--npm-tag <dist-tag>`         | npm dist-tag                                                                                                 | inferred from the prerelease `preid` |
| `--filter <name>[,<name>]`     | Only publish matching packages (by name or directory). Applied before `--from`.                              | —                                    |
| `--from <name>`                | Start publishing from the first package matching this selector, computed against the post-`--filter` list.   | —                                    |
| `--root-files <file>[,<file>]` | Files to copy from the monorepo root into each publish dir. Missing files are skipped.                       | `['LICENSE']`                        |
| `--publish-dir <path>`         | Publish directory inside each package.                                                                       | `dist`                               |
| `--version-placeholder <text>` | Placeholder rewritten to the target version.                                                                 | `0.0.0-PLACEHOLDER`                  |
| `--dry-run`                    | Forward `--dry-run` to `npm publish`.                                                                        | `false`                              |
| `-h, --help`                   | Show help                                                                                                    | —                                    |

## Config File

Use `--config` when you want repo-specific options without spelling them on the
command line. JSON, `.mjs`, and `.cjs` (`module.exports`) configs are all
supported; use a JS file when you need non-JSON values.

```js
/** @type {import('@repo-toolkit/publish-all').PublishAllOptions} */
export default {
  tag: '1.2.3',
  filters: ['changelog'],
  rootFiles: ['LICENSE', 'NOTICE'],
  publishDir: 'dist',
  versionPlaceholder: '0.0.0-PLACEHOLDER',
  dryRun: true,
};
```

```sh
repo-toolkit-publish-all --config publish.config.mjs
```

CLI flags override values from the config file.

## JavaScript API

```ts
import { publishAll } from '@repo-toolkit/publish-all';

publishAll({
  tag: '1.2.3',
  cwd: '/path/to/monorepo',
  filters: ['changelog'],
  rootFiles: ['LICENSE', 'NOTICE'],
  publishDir: 'dist',
  versionPlaceholder: '0.0.0-PLACEHOLDER',
  dryRun: true,
});
```

### Exports

Pure helpers (no filesystem or process side effects):

- `inferNpmTag(version)` — derive the npm dist-tag from a version string.
- `createPublishPackageJson(...)` — rewrite a package manifest for publish.
- `sortPackagesByInternalDependencies(...)` — topologically sort internal packages (throws on cycles).

Pipeline (side-effectful):

- `resolvePublishPlan(options)` — resolve a publish plan (reads filesystem) without publishing. Useful for previewing which packages would be selected.
- `publishAll(options)` — run the full build + publish pipeline.

### Options

| Option               | Type                  | Description                                                                                                    |
| -------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `tag`                | `string` _(required)_ | Target version. A leading `v` is stripped.                                                                     |
| `cwd`                | `string`              | Monorepo root directory. Defaults to `process.cwd()`.                                                          |
| `npmTag`             | `string`              | npm dist-tag. Defaults to the prerelease `preid`.                                                              |
| `filters`            | `string[]`            | Only publish matching packages (by name or directory).                                                         |
| `from`               | `string`              | Start publishing from the first matching package.                                                              |
| `rootFiles`          | `string[]`            | Files to copy from the monorepo root into each publish dir. Missing files are skipped. Default: `['LICENSE']`. |
| `publishDir`         | `string`              | Publish directory inside each package. Default: `dist`.                                                        |
| `versionPlaceholder` | `string`              | Placeholder rewritten to the target version. Default: `0.0.0-PLACEHOLDER`.                                     |
| `dryRun`             | `boolean`             | Forward `--dry-run` to `npm publish`.                                                                          |

## Version Placeholders

Dependency ranges set to `0.0.0-PLACEHOLDER` are replaced with the target
version by default. Override this with `versionPlaceholder` /
`--version-placeholder` when your workspace uses a different sentinel value.

`workspace:` ranges on internal packages are resolved to the target version
(or kept verbatim when pinned to an explicit version).
