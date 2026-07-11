# AGENTS.md

Guidance for AI agents (and humans) working in this repository.

## Repository layout

This is a pnpm workspace monorepo for the `@repo-toolkit/*` packages.

- `packages/changelog` — conventional changelog preset, generator, and `repo-toolkit-changelog` CLI.
- `packages/publish-package` — single-package npm publish engine and `repo-toolkit-publish-package` CLI. Foundational package that the others import shared helpers from.
- `packages/publish-packages` — monorepo publish pipeline and `repo-toolkit-publish-packages` CLI. Depends on `@repo-toolkit/publish-package`.
- `packages/release-artifact` — release artifact builder/verifier and `repo-toolkit-build-artifact` / `repo-toolkit-verify-artifact` CLIs. Depends on `@repo-toolkit/publish-package`.
- `bin/` — asdf plugin scripts (`download`, `install`, `list-all`, `lib/repo-toolkit.sh`) that consume the tarball produced by `release-artifact`.
- `website/` — standalone Docusaurus docs site (separate pnpm project; do not run its install from the workspace root).
- `scripts/` — none. Repository-level scripts live inside the packages.

## Commands

Run from the repository root after `pnpm install`:

```sh
pnpm lint         # eslint . — flat config (ESLint 10)
pnpm lint-fix     # eslint --fix .
pnpm typecheck    # tsc --noEmit in each package via pnpm -r exec
pnpm build        # tsup build in dependency order (pnpm -r --if-present build)
pnpm test         # vitest in each package (pnpm -r --if-present test)
```

Package-specific commands (each builds its dependency closure first):

```sh
pnpm changelog           # build + run repo-toolkit-changelog
pnpm publish-package -- --version v1.2.3
pnpm publish-packages -- --version v1.2.3
pnpm build-artifact -- --version v1.2.3
pnpm verify-artifact -- --version v1.2.3
pnpm release             # release-it (uses .release-it.json)
```

Always run **both** `pnpm lint` and `pnpm typecheck` after code changes, and `pnpm test` for anything that touches `src/` or `test/`. The `typecheck` script catches issues the build pipeline does not (e.g. lib-target mismatches such as `Array.prototype.at` under the packages' ES2018 target).

## Conventions

### Adding a new package

Mirror an existing package exactly. Each package has these 8 files:

- `package.json` — `name "@repo-toolkit/<pkg>"`, `"version": "0.0.0-PLACEHOLDER"`, `"license": "PLACEHOLDER"`, `"repository": "PLACEHOLDER"`, `"type": "module"`, `"sideEffects": false`, standard `exports`/`files`/`engines` block, `bin` entry, scripts: `build` (`tsup --config tsup.config.ts`), `test` (`pnpm --filter @repo-toolkit/<pkg>... build && vitest run --config vitest.config.ts`), `<pkg>` (`node dist/cli.js`).
- `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` — byte-identical across packages; copy verbatim.
- `src/index.ts` — exported `*Options` interface (optional/defaulted `options = {}`), exported `resolve*Plan` + runner function. Import shared helpers (`isPlainObject`, `normalizeVersion`, `inferNpmTag`, `parseFlags`, `loadConfigFile`, `readValue`, `splitListArg`) from `@repo-toolkit/publish-package`.
- `src/cli.ts` — thin wrapper: define a `SPECS: FlagSpec[]` table, call `parseFlags`, build the options object, run the runner. Always end with `main().catch` that sets `process.exitCode = 1` (do not call `process.exit`).
- `test/index.test.ts` — vitest, `describe`/`it`, temp fixtures with `try/finally` cleanup.
- `README.md` — concise; longer guides go in `website/docs/packages/<pkg>.md`.

After scaffolding:

1. Add path aliases to `tsconfig.base.json`:
   ```json
   "@repo-toolkit/<pkg>": ["packages/<pkg>/src/index.ts"],
   "@repo-toolkit/<pkg>/*": ["packages/<pkg>/src/*"]
   ```
2. Add a root script in `package.json`:
   ```json
   "<pkg>": "pnpm --filter @repo-toolkit/<pkg>... build && node packages/<pkg>/dist/cli.js"
   ```
3. Add the package to `README.md` (Packages list + Workspace Layout) and `website/docs/packages/index.md`.
4. The `release-artifact` builder auto-discovers `packages/*/package.json` `bin` entries, so any new `bin` is exposed automatically — no edit needed in `packages/release-artifact`.

### CLI argument parsing

Use `parseFlags(argv, specs)` from `@repo-toolkit/publish-package`. The `FlagSpec` shape supports:

- `name` (canonical, without `--`) and `aliases`.
- `boolean: true` (no value consumed); `negatable: true` to accept `--no-<name>`.
- `list: true` (comma-split, accumulating into `repeat[name]`).
- `repeatable: true` (one raw value per occurrence into `repeat[name]`).

The parser returns `null` for `-h`/`--help` (caller prints help and returns), throws `Unknown argument: <arg>` in strict mode (default), and throws `Missing value for --flag` for missing or dash-leading values (matching the older hand-rolled loops). `--flag=value` accepts dash-leading values that the `--flag value` form rejects.

Do not introduce a new argument-parsing library (commander/yargs/etc.). The hand-rolled parser is intentional — the packages stay zero-runtime-dep where possible.

### TypeScript

Each package `tsconfig.json` extends `../../tsconfig.base.json` and sets `target: ES2018`, `module: ESNext`, `moduleResolution: Bundler`, `strict: true`. `tsup` bundles to `dist/` with `target: node20`, and `dts: true` only for `src/index.ts`. CLI entrypoints are bundled separately with a `#!/usr/bin/env node` banner and `dts: false`.

`strict` is on (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, etc.). When a third-party dep ships no types, add a one-line ambient `declare module '...';` declaration under `src/` (see `packages/changelog/src/conventional-changelog-conventionalcommits.d.ts`) rather than loosening `strict`. Do not enable `noUncheckedIndexedAccess` package-wide without coordinating — it is invasive and not part of the current convention.

Avoid `Array.prototype.at` / `Object.hasOwn` / other post-ES2018 lib features in `src/` — `tsc --noEmit` will fail (the `typecheck` script catches this). Use index access and `Object.prototype.hasOwnProperty.call` instead.

### Publishing and the release flow

- The root `package.json` is `private: true` and never published.
- Each package's `package.json` uses `0.0.0-PLACEHOLDER` for `version`/`license`/`repository`; `@repo-toolkit/publish-packages` rewrites the placeholder to the target version and merges root `author`/`license`/`repository`/`engines` at publish time.
- `workspace:*` ranges on internal deps are resolved to the target version.
- `release-it` (`.release-it.json`) bumps `VERSION` and root `package.json` via `@release-it/bumper`; the publish workflow runs `pnpm publish-packages -- --version <tag>` from git tags.
- The `release-artifact` builder assembles a `<toolName>-<version>.tar.gz` for asdf consumption; the release workflow uploads it to the GitHub release. The `bin/install` asdf script extracts that tarball, reads `artifact-manifest.json`, and validates `requiredFiles`.

## Do not

- Do not commit unless explicitly asked.
- Do not call `process.exit()` from library or CLI code; set `process.exitCode = 1` and throw.
- Do not add comments to code unless asked.
- Do not introduce new runtime dependencies without checking that they are already used in the repo.
- Do not edit `website/` from the workspace root — it is a separate pnpm project.
- Do not create `dist/` artifacts in commits (gitignored; produced by `pnpm build`).
