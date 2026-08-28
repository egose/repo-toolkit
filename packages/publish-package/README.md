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
- `parseFlags(argv, specs, options?)` — the shared hand-rolled CLI parser. Throws on unknown arguments in strict mode (default), returns `null` for `-h` / `--help`, and treats `--` as a real parsing terminator that stops further flag parsing silently.
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
- `version` _(string)_ Target package version. Defaults to `package.json.version`. A leading `v` is stripped.
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
- `dryRun` _(boolean)_ Forward `--dry-run` to `npm publish`.
- `internalPackageNames` _(string[] | Set\<string>)_ Names treated as internal workspace packages for dependency-range rewriting.
- `runner` _(ProcessRunner)_ Injectable subprocess runner (see [Process runner](#process-runner)). Defaults to `defaultProcessRunner`, which spawns via `execFileSync` with inherited stdio.

## Docs

The longer guide lives in the workspace documentation site under
`website/docs/packages/publish-package.md`.
