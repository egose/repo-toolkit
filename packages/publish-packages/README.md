# `@repo-toolkit/publish-packages`

Build, stage, and publish every package in a monorepo to npm in dependency order.

## Installation

```sh
pnpm add -D @repo-toolkit/publish-packages
```

## CLI

```sh
repo-toolkit-publish-packages --version v1.2.3
```

Run the binary from the monorepo root. `publish-packages` discovers packages
under `packages/*`, sorts them by internal dependency order, filters the
selection, and then calls `@repo-toolkit/publish-package` for each package.

`--tag` is still accepted as a compatibility alias, but `--version` is the
preferred spelling.

Useful flags:

- `--config <path>` Config file with publish options (JSON, `.mjs`, or `.cjs` default export). CLI flags override config values.
- `--cwd <path>` Monorepo root directory (default: `process.cwd()`).
- `--version <version>` Target version (required). A leading `v` is stripped.
- `--tag <version>` Compatibility alias for `--version`.
- `--npm-tag <dist-tag>` npm dist-tag (defaults to the prerelease `preid`).
- `--filter <name>[,<name>]` Only publish matching packages (by name or directory). Applied before `--from`.
- `--from <name>` Start publishing from the first package matching this selector, computed against the post-`--filter` list.
- `--package-files <file>[,<file>]` Files copied from each package root into the publish dir.
- `--root-files <file>[,<file>]` Files to copy from the monorepo root into each publish dir (default: `['LICENSE']`). Missing files are skipped.
- `--publish-dir <path>` Publish directory inside each package (default: `dist`).
- `--version-placeholder <text>` Placeholder rewritten to the target version (default: `0.0.0-PLACEHOLDER`).
- `--build-command <command>` Command used to build each publish dir (default: `pnpm build`).
- `--skip-build` Skip the build step.
- `--access <level>` npm publish access level (default: `public`).
- `--registry <url>` npm registry URL.
- `--otp <code>` npm OTP code.
- `--provenance` Request npm provenance attestation.
- `--dry-run` Forward `--dry-run` to `npm publish`.

## Config File

Use `--config` when you want repo-specific options without spelling them on the
command line. JSON, `.mjs`, and `.cjs` (default / `module.exports`) configs are
all supported; use a JS file when you need non-JSON values.

```js
/** @type {import('@repo-toolkit/publish-packages').PublishPackagesOptions} */
export default {
  version: '1.2.3',
  filters: ['changelog'],
  packageFiles: ['README.md', 'llms.txt'],
  rootFiles: ['LICENSE', 'NOTICE'],
  publishDir: 'dist',
  versionPlaceholder: '0.0.0-PLACEHOLDER',
  buildCommand: 'pnpm build',
  dryRun: true,
};
```

Run it with:

```sh
repo-toolkit-publish-packages --config publish.config.mjs
```

CLI flags override values from the config file.

## JavaScript API

```ts
import { publishPackages } from '@repo-toolkit/publish-packages';

publishPackages({
  version: '1.2.3',
  cwd: '/path/to/monorepo',
  filters: ['changelog'],
  packageFiles: ['README.md', 'llms.txt'],
  rootFiles: ['LICENSE', 'NOTICE'],
  publishDir: 'dist',
  versionPlaceholder: '0.0.0-PLACEHOLDER',
  dryRun: true,
});
```

### Exports

- `sortPackagesByInternalDependencies(...)` Topologically sort internal packages (throws on cycles).
- `resolvePublishPackagesPlan(options)` Resolve the selected package list and shared publish options without publishing.
- `publishPackages(options)` Run the full workspace publish pipeline.
- `inferNpmTag(version)` Derive the npm dist-tag from a version string.

For generic single-package manifest rewriting and npm publish plumbing, use
`@repo-toolkit/publish-package`.

### Options

- `version` _(string, required)_ Target version. A leading `v` is stripped.
- `cwd` _(string)_ Monorepo root directory. Defaults to `process.cwd()`.
- `npmTag` _(string)_ npm dist-tag. Defaults to the prerelease `preid`.
- `filters` _(string[])_ Only publish matching packages (by name or directory).
- `from` _(string)_ Start publishing from the first matching package.
- `packageFiles` _(string[])_ Files copied from each package root into the publish dir.
- `rootFiles` _(string[])_ Files to copy from the monorepo root into each publish dir (default: `['LICENSE']`). Missing files are skipped.
- `publishDir` _(string)_ Publish directory inside each package (default: `dist`).
- `versionPlaceholder` _(string)_ Placeholder rewritten to the target version (default: `0.0.0-PLACEHOLDER`).
- `buildCommand` _(string)_ Command used to build each publish dir (default: `pnpm build`).
- `skipBuild` _(boolean)_ Skip the build step.
- `access` _(string)_ npm publish access level (default: `public`).
- `registry` _(string)_ npm registry URL.
- `otp` _(string)_ npm OTP code.
- `provenance` _(boolean)_ Request npm provenance attestation.
- `dryRun` _(boolean)_ Forward `--dry-run` to `npm publish`.

## Version Placeholders

Dependency ranges set to `0.0.0-PLACEHOLDER` are replaced with the target
version by default. Override this with `versionPlaceholder` /
`--version-placeholder` when your workspace uses a different sentinel value.

`workspace:` ranges on internal packages are resolved to the target version
(or kept verbatim when pinned to an explicit version).
