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
| `--version <version>`             | Target package version. A leading `v` is stripped. Mutually exclusive with `--bump`.                         | `package.json.version`                      |
| `--tag <version>`                 | Alias for `--version`                                                                                        | —                                           |
| `--bump <major\|minor\|patch>`    | Derive the version from the npm registry. Mutually exclusive with `--version`.                               | —                                           |
| `--npm-tag <dist-tag>`            | npm dist-tag                                                                                                 | inferred from the prerelease `preid`        |
| `--publish-dir <path>`            | Publish directory inside the package root.                                                                   | `dist`                                      |
| `--preserve-publish-dir`          | Keep publishDir inside the npm package (default: flattened to package root)                                  | `false`                                     |
| `--version-placeholder <text>`    | Placeholder rewritten to the target version.                                                                 | `0.0.0-PLACEHOLDER`                         |
| `--package-files <file>[,<file>]` | Files copied from the package root into the publish dir (replaces defaults). Subpaths are flattened.         | `['README.md', 'CHANGELOG.md', 'llms.txt']` |
| `--include-package-file <path>`   | Additional file copied from the package root (repeatable, additive).                                         | —                                           |
| `--no-default-package-files`      | Skip copying default package files.                                                                          | `false`                                     |
| `--root-files <file>[,<file>]`    | Files copied from `rootDir` into the publish dir (replaces defaults).                                        | `['LICENSE']`                               |
| `--include-root-file <path>`      | Additional file copied from `rootDir` (repeatable, additive).                                                | —                                           |
| `--no-default-root-files`         | Skip copying default root files.                                                                             | `false`                                     |
| `--build-command <command>`       | Command used to build the publish dir.                                                                       | `pnpm build`                                |
| `--skip-build`                    | Skip the build step                                                                                          | `false`                                     |
| `--access <level>`                | npm publish access level                                                                                     | `public`                                    |
| `--registry <url>`                | npm registry URL                                                                                             | —                                           |
| `--otp <code>`                    | npm OTP code                                                                                                 | —                                           |
| `--provenance`                    | Request npm provenance attestation                                                                           | `false`                                     |
| `--dry-run`                       | Forward `--dry-run` to `npm publish` (npm is still invoked).                                                 | `false`                                     |
| `--publish-access <level>`        | Inject `publishConfig.access` into generated manifests.                                                      | —                                           |
| `--prepare-only`                  | Prepare and pack artifacts **without** calling `npm publish` at all.                                         | `false`                                     |
| `--allow-private-template`        | Explicit opt-in to use a `private: true` source manifest as a template. The output never carries `private`.  | `false`                                     |
| `-h, --help`                      | Show help                                                                                                    | —                                           |

### Version selection

Exactly one of the following decides the release version:

1. `--version <v>` / config `version` — an explicit semver version (one leading `v` is stripped). Mutually exclusive with `bump`, regardless of whether the values came from the CLI or the config file. CLI values override config values for the same field.
2. `--bump <major|minor|patch>` / config `bump` — resolves the prior published version with `npm view <name> version --json` (honoring `--registry`) and applies the bump. Only a _confirmed package-absence_ response starts from `0.0.0` (so a patch bump yields `0.0.1`). Authentication failures, timeouts, network errors, registry 5xx responses, malformed JSON, and invalid registry versions are fatal — they are never treated as "first release".
3. Neither — `package.json.version` (which must not still be the version placeholder).

### Prepare-only vs npm dry-run

- `--prepare-only` / `prepareOnly: true` prepares every artifact (staging, builds, manifest generation, overlays, validation, and packing when required) and then **returns without invoking `npm publish` at all**. The prepared stage directories and tarballs are retained so you can inspect them; their locations are returned as `PreparedPackageArtifact[]` (`stageDir`, optional `tarballPath`) and default to `<publishDir>/.artifacts/<id>/` per recipe.
- `--dry-run` is different: it forwards `--dry-run` to `npm publish`, which means npm **is still invoked** (and performs its own dry-run checks).

When a publish is requested, **every artifact finishes preparation and packing before the first `npm publish` runs** — a build, overlay, validation, or pack failure for any artifact publishes nothing.

### Private source templates

By default a source manifest with `"private": true` is refused. `--allow-private-template` / `allowPrivateTemplate: true` is an explicit safety opt-in that permits using such a manifest as a non-publishable _template_: the generated release manifest **never** carries a `private` field, regardless of the opt-in.

### Publish layout

`publishDir` remains the build-output directory (default `dist`). The layout choice only affects how that directory appears inside the published npm tarball. **Flattened publishing remains the default.**

- **Default (flattened, `preservePublishDir: false`)**: the contents of `publishDir` become the npm package root. A build file `dist/index.js` is published as `package/index.js` and manifest fields are rewritten (`"main": "dist/index.js"` → `"main": "./index.js"`, likewise `module`/`types`/`bin`/`exports`/`imports`).
  - Tarball: `package/index.js`, `package/index.d.ts`, `package/README.md`, `package/LICENSE`
  - Manifest: `{ "main": "./index.js", "types": "./index.d.ts" }`
- **Opt-in preserved (`--preserve-publish-dir` / `preservePublishDir: true`)**: the configured directory is retained inside the package. `dist/index.js` is published as `package/dist/index.js` and manifest paths keep their prefix (`"main": "./dist/index.js"`).
  - Tarball: `package/dist/index.js`, `package/dist/index.d.ts`, `package/README.md`, `package/LICENSE`
  - Manifest: `{ "main": "./dist/index.js", "types": "./dist/index.d.ts" }`
  - A custom `publishDir` such as `artifacts/npm` is retained as `package/artifacts/npm/**`, not reduced to its basename.

Preserved mode uses an isolated temporary staging root rather than publishing from the source package root, so only the build output, generated `package.json`, and configured `packageFiles`/`rootFiles` are included — repository `src/`, tests, and other source files are not published wholesale.

## Config File

```js
/** @type {import('@repo-toolkit/publish-package').PublishPackageOptions} */
export default {
  cwd: process.cwd(),
  version: '1.2.3',
  rootFiles: ['LICENSE'],
  packageFiles: ['README.md', 'CHANGELOG.md'],
  publishDir: 'dist',
  preservePublishDir: false,
  versionPlaceholder: '0.0.0-PLACEHOLDER',
  buildCommand: 'pnpm build',
  dryRun: true,
};
```

### Artifact recipes

Pass `artifacts` in a JavaScript config (`.mjs`/`.cjs`, default export or a named `artifacts` export) or the API to define several independently staged and published packages. Each recipe takes `id`, `packageName`, an optional isolated `stageDir` (default `<publishDir>/.artifacts/<id>`), optional `build`/`validate` hooks receiving a constrained context, an optional `manifestOverlay` (object or function), `requireTarball` (pack via `npm pack --json --ignore-scripts` and publish the exact tarball), `preserveSourceFiles`, and `publishAccess`.

```js
/** @type {import('@repo-toolkit/publish-package').PublishPackageOptions} */
export default {
  version: '1.2.3',
  artifacts: [
    {
      id: 'widget',
      packageName: '@example/widget',
      requireTarball: true,
      build({ stageDir }) {
        // build the standard widget bundle into stageDir
      },
    },
    {
      id: 'widget-min',
      packageName: '@example/widget-min',
      requireTarball: true,
      build({ stageDir }) {
        // build the minified variant into its own isolated stageDir
      },
      manifestOverlay({ packageName }) {
        return { exports: { '.': './index.min.js' }, description: `${packageName} (minified)` };
      },
      validate({ stageDir }) {
        // throw if the staged artifact fails package-specific checks
      },
    },
    {
      id: 'widget-debug',
      packageName: '@example/widget-debug',
      preserveSourceFiles: true,
      build({ stageDir }) {
        // build the debug variant
      },
    },
  ],
};
```

Manifest overlays follow a protected-field deny-list: `private`, `scripts`, `devDependencies`, and `packageManager` are always rejected; `version` and `name` may not conflict with the release version and recipe package name; `exports` must pass the same shape validation as source manifests. After merging, dependency-range rewriting and full manifest validation re-run.

Executable hooks require a JavaScript config. A JSON config may only express the declarative recipe fields (plus a static object `manifestOverlay`); a JSON config that names a hook or a non-object overlay fails with an error telling you to use a JavaScript config.

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
