# Optional Preserved Publish Directory

Created: 2026-08-28 10:19:31

## Objective

Add an opt-in publish layout that keeps the configured `publishDir` (normally `dist/`) inside the npm package instead of treating that directory as the package root. Preserve the current flattened layout as the default for both `@repo-toolkit/publish-package` and `@repo-toolkit/publish-packages`.

The proposed public contract is `preservePublishDir?: boolean` in the JavaScript/config APIs and `--preserve-publish-dir` in both CLIs. When omitted or `false`, publishing must remain byte-for-byte compatible in layout with the current behavior. When `true`, a source manifest path such as `./dist/index.js` must remain `./dist/index.js` in the published manifest and the packed artifact must contain `dist/index.js`.

## Scope And Working Rules

- Keep `publishDir` as the build-output directory; do not redefine its existing meaning.
- Do not publish directly from the source package root or temporarily overwrite its `package.json`. The release manifest contains rewritten versions, workspace dependency ranges, and inherited root metadata, so preserved-directory mode requires an isolated staging root.
- Keep the existing flattened path as the default and avoid adding compatibility aliases for the new option.
- Preserve privacy checks, realpath containment, copy-source validation, collision detection, OTP redaction, multi-name sequencing, and failure behavior.
- Do not add a runtime dependency. Use Node 20 filesystem APIs and the existing injectable `ProcessRunner`.
- Do not commit generated `dist/` output.
- Do not revert or modify unrelated concurrent worktree changes.

## Non-Goals

- Changing the default npm package layout.
- Changing where `pnpm build` writes output.
- Publishing arbitrary files from the source package root.
- Supporting an arbitrary mapping between build-output and artifact directories in this change.
- Redesigning the manifest rewrite API beyond the smallest option needed to suppress publish-directory prefix removal.

## Confirmed Baseline

- `DEFAULT_PUBLISH_DIR` is `dist`, and `resolvePublishPackagePlan` resolves it beneath the package root (`packages/publish-package/src/manifest.ts:20`, `packages/publish-package/src/plan.ts:100-150`).
- `publishPackage` currently copies package/root files and writes the generated `package.json` directly into `resolvedPublishDir`, then invokes `npm publish` with that directory as `cwd` (`packages/publish-package/src/publish.ts:16-61`, `packages/publish-package/src/publish.ts:70-97`). This makes the contents of `dist/` the npm package root.
- `createPublishPackageJson` removes the configured publish-directory prefix from `main`, `module`, `types`, `bin`, `exports`, and `imports` (`packages/publish-package/src/manifest.ts:48-106`, `packages/publish-package/src/manifest.ts:336-403`).
- Existing tests assert the default rewritten paths and direct staging into a custom publish directory (`packages/publish-package/test/index.test.ts:293-348`, `packages/publish-package/test/index.test.ts:835-898`).
- Both package CLIs expose `--publish-dir`; `publish-packages` forwards the resolved value into `publishPackage` (`packages/publish-package/src/cli.ts:15-106`, `packages/publish-packages/src/cli.ts:12-102`, `packages/publish-packages/src/index.ts:442-465`).
- The worktree was clean when this task was created (`git status --short` produced no output).
- No tests were run while preparing this planning document; findings are based on source, test, metadata, and documentation inspection.

## Priorities

- P1: Required public behavior, artifact correctness, cleanup, or prevention of a release regression.
- P2: CLI propagation, documentation, and independent integration evidence required to ship the option confidently.

## Wave 1: Core Layout Contract

### Task PPDIR-01: Implement Isolated Preserved-Directory Staging

Status: completed

Completion evidence:

- `packages/publish-package/src/plan.ts:22,65-66,77-101,152` added `preservePublishDir?: boolean` to `PublishPackageOptions` and `preservePublishDir: boolean` to `PublishPackagePlan` default `false`.
- `packages/publish-package/src/manifest.ts:35-40,54-58,82-97,342-416` added `preservePublishDir?: boolean` to `PublishRewriteOptions`; `createPublishPackageJson` conditional rewrite suppresses `publishDir` prefix removal when true, retains `./dist/foo` and `dist/foo` while default `false` preserves `dist/foo -> ./foo` flattening for `main/module/types/bin/exports/imports`.
- `packages/publish-package/src/publish.ts:1-18,50-118,126-151,232-279` keeps direct staging to `resolvedPublishDir` with `cwd === resolvedPublishDir` for default mode (no overhead); preserved mode creates isolated `mkdtempSync(tmpdir()/repo-toolkit-publish-)` staging root, reproduces `publishDir` via `resolve(stagingRoot, plan.publishDir)` (supports `artifacts/npm`), `copyBuildOutputRecursively` preserves nested paths and `chmodSync` mode bits, safe symlink policy via `lstatSync/readlinkSync/realpathSync` skipping escaping links (`isPathWithinRoot(packageRoot) && isPathWithinRoot(srcReal)`), places `package.json` per `packageName` before each `runNpmPublish` from staging root, `finally rmSync` cleans up after success/dry-run/build/copy/npm failure without deleting original `dist`. Supplemental `packageFiles/rootFiles` remain at package root with basename flattening and `detectCopyCollisions`.
- Verified: `pnpm --filter @repo-toolkit/publish-package test` 110 passed at implementation, `pnpm lint` pass, `pnpm typecheck` pass; preserved manifest retains prefixes, staging contains `dist/**` + `README.md/LICENSE/package.json` without `src/`, custom nested `artifacts/npm/**` retained, symlink escaping test shows external marker not disclosed, staging cleanup proven after success and injected npm failure, original `publishDir` intact.

Priority: P1

Suggested agent: TypeScript package publishing engineer

Dependencies: none

Primary ownership:

- `packages/publish-package/src/plan.ts`
- `packages/publish-package/src/manifest.ts`
- `packages/publish-package/src/publish.ts`
- `packages/publish-package/src/index.ts`
- focused tests in `packages/publish-package/test/index.test.ts`

Finding:

The current staging root and build-output directory are the same location. Preserving `dist/` therefore cannot be implemented only by disabling manifest path rewriting: `npm publish` would still run from `dist/`, and the tarball would still expose its contents at package root. Publishing from the source root is also unsafe because the generated release manifest differs from the checked-in source manifest.

References:

- `packages/publish-package/src/publish.ts:16-61`
- `packages/publish-package/src/publish.ts:70-97`
- `packages/publish-package/src/manifest.ts:48-106`
- `packages/publish-package/src/manifest.ts:336-403`
- `packages/publish-package/src/plan.ts:22-98`

Implementation requirements:

1. Add `preservePublishDir?: boolean` to `PublishPackageOptions`, resolve it to a non-optional `boolean` in `PublishPackagePlan`, and default it to `false`.
2. Extend the manifest rewrite contract so path-prefix removal is conditional. Default calls to `createPublishPackageJson` must continue rewriting `dist/foo` to `./foo`; preserved mode must retain valid source paths such as `./dist/foo` and `dist/foo` without changing unrelated manifest transformations.
3. Keep the current direct staging and `npm publish` cwd for default flattened mode. Do not introduce temporary staging overhead or behavior changes when `preservePublishDir` is false.
4. In preserved mode, create an isolated temporary staging root, reproduce the configured relative `publishDir` beneath it, copy the complete build output into that nested location, place generated `package.json` and configured package/root files at the staging root, and run `npm publish` from the staging root.
5. Preserve nested output paths and executable mode bits. Define and test a safe symlink policy rather than following links outside `resolvedPublishDir`; escaping links must never copy external content into staging.
6. Ensure temporary staging is removed in `finally` after success, dry-run, build failure, copy/manifest failure, or any npm failure. Never delete or alter the original build output during cleanup.
7. Continue writing one generated manifest per `packageName` immediately before each publish invocation, preserving current `additionalNames` sequencing.
8. Keep package/root supplemental files at npm package root in preserved mode (for example `README.md` and `LICENSE`), including the existing basename flattening and collision checks for those configured files.
9. Ensure the generated `files` field includes the staged nested output and supplemental root files while still excluding source maps according to the existing contract.
10. Do not weaken package privacy, path containment, regular-file checks, or npm argument/environment handling.

Acceptance criteria:

- With no new option, the plan resolves `preservePublishDir` to `false`, manifest paths are flattened, generated `package.json` is written to `resolvedPublishDir`, and npm runs with `cwd === resolvedPublishDir` exactly as before.
- With `preservePublishDir: true`, a package configured with `main: "dist/index.js"`, `types: "./dist/index.d.ts"`, `bin`, nested `exports`, and `imports` retains those publish-directory prefixes in its generated manifest.
- Preserved mode publishes from an isolated staging root containing `package.json`, root documentation/license files, and `dist/**`; it does not include `src/`, tests, configs, or other source-root files.
- A custom nested `publishDir` such as `artifacts/npm` is retained as `artifacts/npm/**`, not reduced to only its basename.
- Recursive build output, executable CLI permissions, sourcemap exclusion, and multiple package names are covered by regression tests using the fake runner and no registry access.
- Tests prove temporary staging cleanup after success and injected npm failure and prove the original `publishDir` remains intact.
- Tests prove an escaping symlink in the build output cannot disclose an external marker file.
- `pnpm --filter @repo-toolkit/publish-package test` passes.

## Wave 2: Public Entry Points

### Task PPDIR-02: Expose And Document The Single-Package Option

Status: completed

Completion evidence:

- `packages/publish-package/src/cli.ts:23,58,92` added `SPECS { name: 'preserve-publish-dir', boolean: true }`, help line `--preserve-publish-dir         Keep publishDir inside the npm package (default: flattened to package root)`, `buildOptions` maps `values['preserve-publish-dir'] !== undefined` to `preservePublishDir: true` (CLI overrides config `false` via `resolveCliOptions` merge).
- `packages/publish-package/README.md:29,45,105-126` added `--preserve-publish-dir` to useful flags, `preservePublishDir` to Options, and **Publish layout** section documenting flattened `dist/index.js -> package/index.js` vs preserved `dist/index.js -> package/dist/index.js` with manifest examples, noting `publishDir` remains build-output and preserved uses isolated staging not source-root publish, prominently stating flattened remains default.
- `website/docs/packages/publish-package.md:41,60-77` added flag table row `false` default and **Publish layout** section with coordinated wording, custom `artifacts/npm` interaction, and config example `preservePublishDir: false`.
- `packages/publish-package/test/cli.test.ts` updated: boolean parse assertion, help/README parity regex including `preserve-publish-dir`, canonical SPECS set, config precedence test showing CLI flag overrides `false`.
- Verified: `pnpm --filter @repo-toolkit/publish-package test` 111 passed, `pnpm lint` pass, `pnpm typecheck` pass, `pnpm --dir website build` success (Generated static files).

Priority: P2

Suggested agent: TypeScript CLI and documentation engineer

Dependencies: PPDIR-01

Primary ownership:

- `packages/publish-package/src/cli.ts`
- `packages/publish-package/test/cli.test.ts`
- `packages/publish-package/README.md`
- `website/docs/packages/publish-package.md`

Finding:

The single-package CLI and README currently describe only `publishDir`; neither exposes a choice between flattened and preserved artifact layouts. CLI tests enforce parity among `SPECS`, help output, and README flags.

References:

- `packages/publish-package/src/cli.ts:15-106`
- `packages/publish-package/test/cli.test.ts:19-134`
- `packages/publish-package/test/cli.test.ts:185-237`
- `packages/publish-package/README.md:21-59`
- `packages/publish-package/README.md:103-126`
- `website/docs/packages/publish-package.md:1-100`

Implementation requirements:

1. Add boolean `--preserve-publish-dir` to `SPECS`, help output, and `buildOptions`, mapping it to `preservePublishDir: true`.
2. Ensure JSON/ESM/CJS config values continue flowing through `resolveCliOptions`, with an explicit CLI flag overriding `false` from config under existing precedence rules.
3. Document both layouts with concrete tarball paths and manifest examples. State prominently that flattened publishing remains the default.
4. Explain that `publishDir` remains the build-output location and that preserved mode uses isolated staging rather than publishing the source package root.
5. Update CLI help/README parity and canonical-spec tests instead of weakening their assertions.
6. Edit and verify the standalone `website/` project according to its own package instructions; do not run a website install from the workspace root.

Acceptance criteria:

- `--preserve-publish-dir` parses to `{ preservePublishDir: true }`, appears in help and README parity checks, and is accepted through config files.
- Documentation shows default `dist/index.js -> package/index.js` and opt-in `dist/index.js -> package/dist/index.js` behavior without implying that repository files are published wholesale.
- Existing CLI behavior and all prior flags remain unchanged.
- `pnpm --filter @repo-toolkit/publish-package test` passes.

### Task PPDIR-03: Propagate Preserved Layout Through Monorepo Publishing

Status: completed

Completion evidence:

- `packages/publish-packages/src/index.ts:40,57-86,107-129,179-224,396,442-472` added `preservePublishDir?: boolean` to `PublishPackagesOptions` and `preservePublishDir: boolean` to `PublishPackagesPlan` default `false`, added to `PUBLISH_PACKAGES_OPTION_KEYS` strict validation with `validateOptionalBoolean`, forwarded unchanged via `toPublishPackageOptions` into every `PublishPackageOptions`.
- `packages/publish-packages/src/cli.ts:26,59,86` added `SPECS { name: 'preserve-publish-dir', boolean: true }`, help line coordinated with single-package wording, `buildOptions` maps flag to `preservePublishDir: true`.
- `packages/publish-packages/test/cli.test.ts` updated boolean parse, config→CLI override parity, README/help regex, SPECS set.
- `packages/publish-packages/test/index.test.ts` added default `preservePublishDir: false`, custom `true` resolution, non-boolean rejection, and forwarding integration tests: flattened `false` → `main: ./index.js` + npm `cwd` ends with `dist`; preserved `true` → `main: dist/index.js` captured from staging root for every selected package; custom nested `artifacts/npm` → `main: artifacts/npm/index.js`.
- `packages/publish-packages/README.md:39,119-125` and `website/docs/packages/publish-packages.md:47,80-89` documented flag, option default `false`, publish layout section with flattened vs preserved and custom nested interaction plus forwarding to every package via isolated staging.
- Verified: `pnpm --filter @repo-toolkit/publish-packages test` 85 passed (3 files), `pnpm lint` pass, `pnpm typecheck` pass, `website build` success.

Priority: P1

Suggested agent: monorepo release pipeline engineer

Dependencies: PPDIR-01

Primary ownership:

- `packages/publish-packages/src/index.ts`
- `packages/publish-packages/src/cli.ts`
- `packages/publish-packages/test/index.test.ts`
- `packages/publish-packages/test/cli.test.ts`
- `packages/publish-packages/README.md`
- `website/docs/packages/publish-packages.md`

Finding:

`publish-packages` owns a parallel public options/plan contract and explicitly forwards selected values into `PublishPackageOptions`. Adding the option only to `publish-package` would make the feature unavailable from the repository's monorepo release pipeline.

References:

- `packages/publish-packages/src/index.ts:26-48`
- `packages/publish-packages/src/index.ts:57-129`
- `packages/publish-packages/src/index.ts:179-220`
- `packages/publish-packages/src/index.ts:442-465`
- `packages/publish-packages/src/cli.ts:12-102`

Implementation requirements:

1. Add `preservePublishDir?: boolean` to `PublishPackagesOptions` and a resolved boolean to `PublishPackagesPlan`, with `false` as the default.
2. Add the key to strict config-option validation and forward it unchanged from the monorepo plan into every `PublishPackageOptions` instance.
3. Add `--preserve-publish-dir` to the monorepo CLI, help, option builder, and CLI parity tests.
4. Add plan/default/forwarding tests proving every selected package receives the same resolved layout choice.
5. Document the option and default in package and website documentation, including its interaction with custom `publishDir` values.
6. Do not change package discovery, graph ordering, filtering, workspace range rewriting, or build sequencing.

Acceptance criteria:

- Omission resolves to `false` and current monorepo release behavior remains flattened.
- API/config/CLI opt-in resolves to `true` and is forwarded to each `publishPackage` call.
- Unknown config keys remain rejected and option validation remains strict.
- Existing dependency-order and selection tests are unchanged except where fixtures need the new resolved field.
- `pnpm --filter @repo-toolkit/publish-packages test` passes.

## Wave 3: Independent Integration

### Task PPDIR-04: Verify Both Packed Artifact Layouts End To End

Status: completed

Completion evidence:

- Independent review inspected `plan.ts:66,98`, `manifest.ts:342-416`, `publish.ts:50-279`, CLI and forwarding logic against all PPDIR-01..03 acceptance criteria — no default regression, no source-root publish, no new runtime dep, no `process.exit`.
- Added `packages/publish-package/test/artifact-layout.test.ts` (3 tests, fake runner, no registry) with rich fixture (`main/module/types: publishDir/index.*`, `bin: publishDir/cli.js` 0755, `exports`/`imports` with `dist` prefixes, nested `feature.js`, sourcemap `index.js.map`, `src/` and `.npmrc` leakage markers, outside `secret.txt` + escaping symlink `dist/link-outside.txt`). Uses `tar 1.35`.
  - Test 1 flattened vs preserved: flattened manifest `main: ./index.js`, preserved retains `dist/` prefixes; flattened root `index.js/README.md/LICENSE` no `dist/index.js`; preserved `dist/index.js/dist/cli.js/README.md/LICENSE/package.json` no root `index.js`; neither includes `src/`, `.map` (via `files` exclusion), symlink leak, `repo-toolkit-publish-`; cleanup verified `existsSync(staging)==false` both success and injected failure; mode `0o111` preserved; `tar --exclude='*.map' -czf` + `tar -tzf` asserts correct listings; consumer `tar -xzf` + `import(pathToFileURL(entry))` → `hello==="hello"` and bin executable.
  - Test 2 custom nested `artifacts/npm`: flattened strips to `./index.js` no `artifacts`, preserved retains `artifacts/npm/index.js` + `bin: artifacts/npm/cli.js` in tar.
  - Test 3 cleanup & leakage: success/failure both remove staging, preserve original `dist`, outside marker not leaked.
- Serialized verification: `pnpm --filter @repo-toolkit/publish-package test` 114 passed (3 files), `pnpm --filter @repo-toolkit/publish-packages test` 85 passed (3 files), `pnpm lint` pass, `pnpm typecheck` pass, `pnpm test` pass (all 8 workspaces: publish-package 114, changelog, compose-sandbox, confluence, go-release, publish-packages, release-artifact), `pnpm --dir website build` success (Generated static files in "build"). `tar --version` GNU 1.35, `npm 11.19.0`. No test contacts registry; all use fake runner.
- Final review confirms whole task file complete: both APIs/CLIs expose `preservePublishDir/--preserve-publish-dir` default `false`, preserved uses isolated cleaned-up staging with full `publishDir` path, manifest/archive/executable/root files agree, docs distinguish build output vs artifact layout.

Priority: P1

Suggested agent: independent release artifact reviewer

Dependencies: PPDIR-02, PPDIR-03

Primary ownership:

- integration/pack tests in `packages/publish-package/test/`
- review of all files changed by PPDIR-01 through PPDIR-03
- this task file's completion evidence

Finding:

Unit assertions on rewritten JSON and runner cwd are insufficient for a public packaging change. Both modes need controlled tarball inspection and consumer-resolution evidence so manifest paths and actual archive paths cannot drift apart.

References:

- `packages/publish-package/test/cli.test.ts:239-277`
- `packages/publish-package/test/index.test.ts:835-898`
- `AGENTS.md` verification requirements

Implementation requirements:

1. Independently inspect the implementation against every prior acceptance criterion; the reviewer should not be the primary PPDIR-01 implementer.
2. Add or extend a controlled artifact test that creates both layouts without contacting a registry, lists each tarball, extracts it to a temporary consumer fixture, and validates declared entry points/types/bin targets exist.
3. Assert the default artifact has root `index.js`-style output and no nested `dist/index.js`; assert preserved mode has `dist/index.js` and no unintended duplicate root `index.js`.
4. Assert neither artifact includes source, tests, source maps, repository configuration, temporary staging names, or external symlink targets.
5. Verify custom nested `publishDir`, executable bin mode, root README/LICENSE placement, and generated manifest `files` behavior.
6. Run targeted checks before full repository checks. Serialize commands that rebuild shared dependency outputs; do not run conflicting recursive builds concurrently.

Acceptance criteria:

- Artifact contents and generated manifest paths agree in default and preserved modes.
- A minimal Node consumer can import the package entry point from each extracted/installed fixture; declared bin targets exist and remain executable where applicable.
- No test invokes a real `npm publish` or contacts an npm registry.
- `pnpm --filter @repo-toolkit/publish-package test` passes.
- `pnpm --filter @repo-toolkit/publish-packages test` passes.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass.
- Any applicable standalone website lint/build command passes, or a concrete environment blocker is recorded.

## Dependencies And Parallelization

- PPDIR-01 owns the behavioral contract and must complete first.
- After PPDIR-01, PPDIR-02 and PPDIR-03 may proceed in parallel because they primarily own different packages, but coordinate the exact option/help wording.
- PPDIR-04 begins only after both public entry points are complete.
- `packages/publish-package/src/index.ts`, shared package builds, and generated `dist/` outputs are shared hotspots. Do not run recursive package tests concurrently when they rebuild the same dependency closure.

## Deferred Decisions

No maintainer decision blocks execution. The task standardizes on `preservePublishDir` / `--preserve-publish-dir` and a default of `false`. If implementation reveals that this name conflicts with an existing external config contract, stop and record the concrete conflict before introducing an alias or choosing a replacement.

## Definition Of Done

- Both APIs and CLIs expose one consistently named opt-in.
- Omission preserves the current flattened manifest, staging cwd, tarball layout, and release behavior.
- Opt-in artifacts retain the complete configured `publishDir` path beneath package root using isolated, cleaned-up staging.
- Manifest entry points, archive contents, executable modes, and supplemental root files agree in both modes.
- `publish-package` and `publish-packages` tests cover defaults, opt-in, custom nested directories, failure cleanup, symlink boundaries, and forwarding.
- Package and website documentation clearly distinguish build output from artifact layout.
- Targeted tests, full lint/typecheck/tests, and controlled artifact/consumer verification pass with evidence recorded under each completed task.
- An independent reviewer confirms no source-root mutation, file leakage, registry access, default behavior regression, or new runtime dependency.
