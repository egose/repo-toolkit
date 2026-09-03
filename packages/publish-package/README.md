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
- `--version <version>` (alias: `--tag`)
- `--bump <major|minor|patch>` (mutually exclusive with `--version`)
- `--npm-tag <dist-tag>`
- `--publish-dir <path>`
- `--preserve-publish-dir`
- `--version-placeholder <text>`
- `--package-files <file>[,<file>]` (replaces defaults)
- `--include-package-file <path>` (repeatable, additive)
- `--no-default-package-files`
- `--root-files <file>[,<file>]` (replaces defaults)
- `--include-root-file <path>` (repeatable, additive)
- `--no-default-root-files`
- `--build-command <command>`
- `--skip-build`
- `--access <level>`
- `--registry <url>`
- `--otp <code>`
- `--provenance`
- `--dry-run`
- `--publish-access <level>`
- `--prepare-only`
- `--allow-private-template` (see [Private source templates](#private-source-templates))

### Version selection

Exactly one of the following decides the release version:

1. `--version <v>` / config `version` — an explicit semver version (one leading `v` is stripped). Mutually exclusive with `--bump`, regardless of whether the values came from the CLI or the config file. CLI values override config values for the same field.
2. `--bump <major|minor|patch>` / config `bump` — resolves the prior published version with `npm view <name> version --json` (honoring `--registry`) and applies the bump. Only a _confirmed package-absence_ response starts from `0.0.0` (so a patch bump yields `0.0.1`). Authentication failures, timeouts, network errors, registry 5xx responses, malformed JSON, and invalid registry versions are fatal — they are never treated as "first release".
3. Neither — `package.json.version` (which must not still be the version placeholder).

### Prepare-only vs npm dry-run

- `--prepare-only` / `prepareOnly: true` prepares every artifact (staging, builds, manifest generation, overlays, validation, and packing when required) and then **returns without invoking `npm publish` at all**. The prepared stage directories and tarballs are retained so you can inspect them; their locations are returned as `PreparedPackageArtifact[]` (`stageDir`, optional `tarballPath`) and default to `<publishDir>/.artifacts/<id>/` per recipe.
- `--dry-run` is different: it forwards `--dry-run` to `npm publish`, which means npm **is still invoked** (and performs its own dry-run checks).

Prepare-only is the safe choice when you want inspectable artifacts without talking to npm; dry-run is a final npm-side rehearsal.

When a publish is requested, **every artifact finishes preparation and packing before the first `npm publish` runs** — a build, overlay, validation, or pack failure for any artifact publishes nothing.

### Private source templates

By default a source manifest with `"private": true` is refused. `--allow-private-template` / `allowPrivateTemplate: true` is an explicit safety opt-in that permits using such a manifest as a non-publishable _template_: the generated release manifest **never** carries a `private` field, regardless of the opt-in.

### Publish layout

`publishDir` remains the build-output directory (default `dist`). The layout choice only affects how that directory appears inside the published npm tarball. Flattened publishing remains the default.

- **Default (flattened, `preservePublishDir: false`)**: the contents of `publishDir` become the npm package root. A build file `dist/index.js` is published as `package/index.js` and manifest fields are rewritten (`"main": "dist/index.js"` → `"main": "./index.js"`, likewise `module`/`types`/`bin`/`exports`/`imports`).
  - Tarball: `package/index.js`, `package/index.d.ts`, `package/README.md`, `package/LICENSE`
  - Manifest: `{ "main": "./index.js", "types": "./index.d.ts" }`
- **Opt-in preserved (`--preserve-publish-dir` / `preservePublishDir: true`)**: the configured directory is retained inside the package. `dist/index.js` is published as `package/dist/index.js` and manifest paths keep their prefix (`"main": "./dist/index.js"`).
  - Tarball: `package/dist/index.js`, `package/dist/index.d.ts`, `package/README.md`, `package/LICENSE`
  - Manifest: `{ "main": "./dist/index.js", "types": "./dist/index.d.ts" }`
  - A custom `publishDir` such as `artifacts/npm` is retained as `package/artifacts/npm/**`, not reduced to its basename.

Preserved mode uses an isolated temporary staging root rather than publishing from the source package root, so only the build output, generated `package.json`, and configured `packageFiles`/`rootFiles` are included — repository `src/`, tests, and other source files are not published wholesale.

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

Supported public helpers consumed by the sibling CLIs and external consumers:

- `createPublishPackageJson(...)` — rewrite a package manifest for publish.
- `resolvePublishPackagePlan(options)` — resolve file/version/publish metadata without publishing.
- `publishPackage(options)` — run the build/copy/npm-publish pipeline for one package.
- `inferNpmTag(version)` — derive the npm dist-tag from a version string.
- `isPlainObject(value)` — shared object guard used by the config loaders and manifest rewriters.
- `normalizeVersion(rawVersion)` — strip a leading `v` and reject empty input.
- `parseFlags(argv, specs, options?)` — the shared hand-rolled CLI parser. Throws on unknown arguments in strict mode (default) and returns `null` for `-h` / `--help`. Bare `--` separators (as inserted by `pnpm run`/`npm run` passthrough) are skipped and parsing **continues** after them; genuinely unknown flags after `--` are still rejected in strict mode.
- `readValue(argv, index, flag)`, `splitListArg(value)` — building blocks for `parseFlags`.
- `loadConfigFile<T>(path, cwd?)`, `resolveConfigPath(path, cwd?)` — JSON / ESM / CJS config loader.
- `resolveCliOptions<T>({ result, buildOptions, cwd })` — merge a parsed CLI result with a `config` file, CLI values win.
- `canPrompt()`, `promptText(opts)`, `promptForRequiredValue(opts)` — interactive prompt helpers; `INTERACTIVE_FLAG` is the canonical `--interactive`/`-i` spec.
- `ProcessRunner`, `ProcessRunOptions`, `defaultProcessRunner` — injectable subprocess runner (see below).
- `DEPENDENCY_FIELDS`, `DEFAULT_VERSION_PLACEHOLDER`, `DEFAULT_PUBLISH_DIR`, `DEFAULT_PACKAGE_FILES`, `DEFAULT_ROOT_FILES`, `DEFAULT_BUILD_COMMAND`, `DEFAULT_ACCESS`, `DEFAULT_PUBLISH_FILES_FIELD` — the package's defaults, exported so downstream packages reuse them rather than hard-coding.
- `validateSourceManifest`, `validateRootManifest` — manifest shape validators used by `resolvePublishPackagePlan`.

The implementation lives in focused internal modules (`./flags`, `./prompt`, `./runner`, `./helpers`, `./manifest`, `./plan`, `./publish`) and is re-exported from the package root. Downstream packages import only via `@repo-toolkit/publish-package`.

### Process runner

`publishPackage` executes the build command and `npm publish` through a `ProcessRunner`. The default runner spawns via `execFileSync` and inherits stdio; tests inject a fake runner to assert exact invocations without contacting a real npm registry.

```ts
import { publishPackage, defaultProcessRunner, type ProcessRunner } from '@repo-toolkit/publish-package';

const runner: ProcessRunner = {
  run(executable, args, options) {
    /* ... */
  },
  runShell(command, options) {
    /* ... */
  },
};

publishPackage({ cwd: '/pkg', version: '1.2.3', dryRun: true, runner });
```

The minimum supported platform contract is Node 20 with `bash` available on `PATH` (the runner's `runShell` invokes `bash -c`). The npm OTP is forwarded through npm's `npm_config_otp` environment variable so it does not appear in argv / process listings, and any OTP value that leaks into a runner error message is redacted.

### Options

- `cwd` _(string)_ Package root directory. Defaults to `process.cwd()`.
- `rootDir` _(string)_ Directory to source `rootFiles` from. Defaults to `cwd`.
- `packageJsonPath` _(string)_ Source package.json path. Defaults to `package.json`.
- `version` _(string)_ Target package version. Defaults to `package.json.version`. A leading `v` is stripped. Rejected if not valid semver. Mutually exclusive with `bump`.
- `bump` _('major' | 'minor' | 'patch')_ Registry-derived version bump (see [Version selection](#version-selection)). Mutually exclusive with `version`.
- `npmTag` _(string)_ npm dist-tag. Defaults to the prerelease `preid`.
- `packageFiles` _(string[])_ Files copied from the package root into the publish dir (default: `['README.md', 'CHANGELOG.md', 'llms.txt']`). Missing files are skipped. Subpaths are flattened (`docs/llms.txt` → `dist/llms.txt`).
- `includePackageFiles` _(string[])_ Additional files appended to `packageFiles`.
- `noDefaultPackageFiles` _(boolean)_ Skip copying default package files.
- `rootFiles` _(string[])_ Files copied from `rootDir` into the publish dir (default: `['LICENSE']`). Missing files are skipped.
- `includeRootFiles` _(string[])_ Additional files appended to `rootFiles`.
- `noDefaultRootFiles` _(boolean)_ Skip copying default root files.
- `publishDir` _(string)_ Publish directory inside the package root (default: `dist`).
- `preservePublishDir` _(boolean)_ Keep the configured `publishDir` inside the npm package instead of flattening it to the package root (default: `false`).
- `versionPlaceholder` _(string)_ Placeholder rewritten to the target version (default: `0.0.0-PLACEHOLDER`).
- `buildCommand` _(string)_ Command used to build the publish dir (default: `pnpm build`).
- `skipBuild` _(boolean)_ Skip the build step.
- `access` _(string)_ npm publish access level (default: `public`).
- `registry` _(string)_ npm registry URL.
- `otp` _(string)_ npm OTP code. Forwarded to npm through its environment (`npm_config_otp`), never as a `--otp` argument.
- `provenance` _(boolean)_ Request npm provenance attestation.
- `dryRun` _(boolean)_ Forward `--dry-run` to `npm publish` (npm is still invoked — see [Prepare-only vs npm dry-run](#prepare-only-vs-npm-dry-run)).
- `publishAccess` _(string)_ Inject `publishConfig.access` into generated manifests. Metadata only; the npm `--access` argument remains the authorization mechanism.
- `prepareOnly` _(boolean)_ Prepare and pack every artifact without invoking `npm publish`. Returns retained `PreparedPackageArtifact[]`.
- `allowPrivateTemplate` _(boolean)_ Explicit opt-in to use a `private: true` source manifest as a template. The generated manifest never contains `private` (see [Private source templates](#private-source-templates)).
- `artifacts` _(PackageArtifactRecipe[])_ Opt-in per-package artifact recipes (see [Artifact recipes](#artifact-recipes)). Cannot be combined with a source manifest `additionalNames` field.
- `internalPackageNames` _(string[] | Set\<string>)_ Names treated as internal workspace packages for dependency-range rewriting.
- `runner` _(ProcessRunner)_ Injectable subprocess runner (see [Process runner](#process-runner)). Defaults to `defaultProcessRunner`, which spawns via `execFileSync` with inherited stdio.

### Artifact recipes

When `artifacts` is supplied, each recipe describes one independently staged, validated, and published package. Without recipes, the package's single flattened default artifact is used. Each recipe takes:

- `id` _(string)_ stable artifact id (safe path segment, unique)
- `packageName` _(string)_ final published package name (unique across recipes)
- `stageDir` _(string, optional)_ isolated stage directory relative to the package root; defaults to `<publishDir>/.artifacts/<id>`
- `build` / `validate` _(functions, optional)_ hooks receiving a constrained `PackageArtifactContext` (absolute cwd/rootDir/stageDir, version, artifact id/name, runner). Throwing fails the artifact.
- `manifestOverlay` _(object or function, optional)_ overlay merged into the generated manifest after build, before validation.
- `requireTarball` _(boolean)_ pack the stage with `npm pack --json --ignore-scripts` and publish the exact tarball.
- `preserveSourceFiles` _(boolean)_ keep the source manifest's `files` allow-list in the generated manifest instead of the safe default `['**/*', '!**/*.map']`.
- `publishAccess` _(string)_ per-artifact `publishConfig.access`, overriding the option-level `publishAccess`.

Manifest overlays follow a protected-field deny-list: `private`, `scripts`, `devDependencies`, and `packageManager` are always rejected; `version` and `name` may not conflict with the release version and recipe package name; `exports` must pass the same shape validation as source manifests. After merging, dependency-range rewriting and full manifest validation re-run.

Executable hooks require a JavaScript config (`.mjs`/`.cjs`, default export or a named `artifacts` export). A JSON config may only express the declarative fields above (plus a static object `manifestOverlay`); a JSON config that names a hook or a non-object overlay fails with an error telling you to use a JavaScript config.

```js
// publish.config.mjs — one standard artifact and two variant artifacts
/** @type {import('@repo-toolkit/publish-package').PublishPackageOptions} */
export default {
  version: '1.2.3',
  prepareOnly: false,
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

## Docs

The longer guide lives in the workspace documentation site under
`website/docs/packages/publish-package.md`.
