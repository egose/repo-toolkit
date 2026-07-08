# `@repo-toolkit/publish-package`

Build, stage, and publish a single package to npm.

## Installation

```sh
pnpm add -D @repo-toolkit/publish-package
```

## CLI

```sh
repo-toolkit-publish-package
```

When `package.json.version` already contains the real release version, you can
omit `--version`. If it still uses the placeholder, pass `--version`
explicitly.

Useful flags:

- `--config <path>`
- `--cwd <path>`
- `--root-dir <path>`
- `--package-json <path>`
- `--version <version>`
- `--npm-tag <dist-tag>`
- `--publish-dir <path>`
- `--version-placeholder <text>`
- `--package-files <file>[,<file>]`
- `--root-files <file>[,<file>]`
- `--build-command <command>`
- `--skip-build`
- `--access <level>`
- `--registry <url>`
- `--otp <code>`
- `--provenance`
- `--dry-run`

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

### Options

- `cwd` _(string)_ Package root directory. Defaults to `process.cwd()`.
- `rootDir` _(string)_ Directory to source `rootFiles` from. Defaults to `cwd`.
- `packageJsonPath` _(string)_ Source package.json path. Defaults to `package.json`.
- `version` _(string)_ Target package version. Defaults to `package.json.version`. A leading `v` is stripped.
- `npmTag` _(string)_ npm dist-tag. Defaults to the prerelease `preid`.
- `packageFiles` _(string[])_ Files copied from the package root into the publish dir (default: `['README.md', 'CHANGELOG.md', 'llms.txt']`). Missing files are skipped.
- `rootFiles` _(string[])_ Files copied from `rootDir` into the publish dir (default: `['LICENSE']`). Missing files are skipped.
- `publishDir` _(string)_ Publish directory inside the package root (default: `dist`).
- `versionPlaceholder` _(string)_ Placeholder rewritten to the target version (default: `0.0.0-PLACEHOLDER`).
- `buildCommand` _(string)_ Command used to build the publish dir (default: `pnpm build`).
- `skipBuild` _(boolean)_ Skip the build step.
- `access` _(string)_ npm publish access level (default: `public`).
- `registry` _(string)_ npm registry URL.
- `otp` _(string)_ npm OTP code.
- `provenance` _(boolean)_ Request npm provenance attestation.
- `dryRun` _(boolean)_ Forward `--dry-run` to `npm publish`.
- `internalPackageNames` _(string[] | Set\<string>)_ Names treated as internal workspace packages for dependency-range rewriting.

## Docs

The longer guide lives in the workspace documentation site under
`website/docs/packages/publish-package.md`.
