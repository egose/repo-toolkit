# Configurable Package Artifact Publishing

Created: 2026-09-02 10:22:51

## Objective

Extend `@repo-toolkit/publish-package` so it can replace the release orchestration in `/home/jahn/projects/shadcn-theme/scripts/publish.mjs` without adding React- or Angular-specific branches to the toolkit. The public contract must support private source manifests used as non-publishable templates, explicit or registry-derived versions, one or more independently prepared artifacts, generated manifest overlays, post-staging validation, exact tarball packing, prepare-only operation, and an all-artifacts-before-publish boundary.

The intended consumer integration is a JavaScript/ESM config or a thin repository adapter. It may supply package-specific artifact recipes for the React and Angular contexts while the toolkit owns release safety, metadata generation, packing, result reporting, and npm publication.

## Scope And Working Rules

- Implement the reusable behavior in `packages/publish-package`; do not encode `react`, `angular`, `tw`, `exports.json`, or shadcn package names in toolkit source.
- Preserve the current single-artifact build/copy/publish behavior when no artifact recipe or new option is supplied.
- Keep refusal of `private: true` as the default. Publishing from a private source manifest requires an explicit safety-named opt-in, and generated manifests must still omit `private`.
- Prepare and validate every artifact before the first `npm publish`. A later build, overlay, validation, or pack failure must publish nothing.
- Keep structured executable/argument invocation shell-free for new lifecycle hooks. Do not put OTP values in argv or logs; retain the existing `npm_config_otp` behavior.
- Keep staging and copied files confined by realpath checks. Generated stage directories and tarballs must never escape configured roots.
- Do not require `shadcn-theme` to become a root pnpm workspace. Its root, React package, and Angular package have separate install/workspace boundaries.
- Do not modify `/home/jahn/projects/shadcn-theme` as part of this toolkit task. Use controlled local fixtures that reproduce its release contract.
- Do not commit generated `dist/` output or modify unrelated concurrent worktree changes.

## Non-Goals

- Moving shadcn's bundle implementations or package validators into this repository.
- Reproducing lodash, fs-extra, yargs, synchronous spawning, or the intermediate `exports.json` file as implementation details.
- Guaranteeing rollback after npm has accepted one artifact. The atomicity boundary is preparation: all artifacts are ready before publication starts.
- Adding workspace discovery or dependency ordering to `publish-package`.
- Extending `publish-packages` in the first implementation. It remains a workspace wrapper and can forward stable generic options in a follow-up if a monorepo consumer requires them.
- Preserving latent shadcn React `additionalNames` or `bundles` behavior that is not currently configured. Existing toolkit `additionalNames` behavior must not regress.

## Confirmed Baseline

- `publishPackage` currently resolves one plan, runs one shell build, stages one output location, and immediately invokes npm for each package name (`packages/publish-package/src/publish.ts:30-118`). It cannot prepare all independent variants before publication.
- The current runner exposes inherited-stdio `run` and `runShell` methods returning `void`; it cannot capture and parse `npm view --json` or `npm pack --json` output (`packages/publish-package/src/runner.ts:3-48`).
- Planning rejects every private source manifest (`packages/publish-package/src/plan.ts:103-118`). Workspace discovery rejects private manifests before filtering (`packages/publish-packages/src/index.ts:276-300`). Both shadcn source manifests are private templates (`/home/jahn/projects/shadcn-theme/packages/react/package.json:2-8`, `/home/jahn/projects/shadcn-theme/packages/angular/package.json:2-11`).
- Explicit versions only have one leading `v` removed and are not semver-validated; placeholder manifests require an explicit version (`packages/publish-package/src/plan.ts:201-219`, `packages/publish-package/src/helpers.ts:35-41`).
- Manifest generation already rewrites version placeholders and dependency ranges, omits release-unsafe fields, rewrites entry paths, and inherits root metadata (`packages/publish-package/src/manifest.ts:5-25`, `packages/publish-package/src/manifest.ts:49-130`, `packages/publish-package/src/manifest.ts:291-416`). It does not replace an `author` value equal to `PLACEHOLDER`, preserve a source `files` allow-list, add `publishConfig`, or accept a generated exports overlay.
- Existing file staging has containment, regular-file, collision, and escaping-symlink controls that the new lifecycle must preserve (`packages/publish-package/src/publish.ts:173-225`, `packages/publish-package/src/publish.ts:232-279`).
- npm publication supports access, dist-tag, registry, OTP through environment, provenance, and npm dry-run (`packages/publish-package/src/publish.ts:126-170`). npm dry-run is not prepare-only because it still calls `npm publish`.
- Angular currently builds isolated `plain` and `tw` stages, consumes a generated exports map, validates and packs both, then publishes exact tarballs (`/home/jahn/projects/shadcn-theme/scripts/publish.mjs:151-210`, `/home/jahn/projects/shadcn-theme/scripts/publish.mjs:231-259`). Its release tests prove second-variant failure prevents all publication and prepare-only retains two inspectable tarballs (`/home/jahn/projects/shadcn-theme/packages/angular/test/release.test.mjs:109-139`).
- React currently builds and publishes one flattened `dist` directory with source-manifest exports (`/home/jahn/projects/shadcn-theme/scripts/publish.mjs:213-228`). Its source `files` allow-list and generated `publishConfig.access` are validated as package metadata (`/home/jahn/projects/shadcn-theme/packages/react/package.json:27-161`, `/home/jahn/projects/shadcn-theme/packages/react/scripts/validate-package.mjs`).
- Target version lookup defaults to a patch bump, starts at `0.0.0` only for confirmed package absence, and treats authentication, network, timeout, registry, malformed JSON, and invalid versions as failures (`/home/jahn/projects/shadcn-theme/scripts/publish.mjs:53-108`, `/home/jahn/projects/shadcn-theme/packages/angular/test/release.test.mjs:69-107`).
- The worktree was clean when this task was created (`git status --short` produced no output).
- No tests were run while preparing this task document. Findings are based on source, test, manifest, and documentation inspection.

## Priorities

- P0: Prevents publishing an unvalidated or unintended artifact, leaks files/secrets, or weakens existing private-package safety.
- P1: Required to cover the current shadcn React or Angular release contract correctly.
- P2: Public CLI/config/documentation work and independent integration evidence required to ship confidently.

## Wave 1: Public Contract And Version Resolution

### Task ARTIFACT-01: Define Backward-Compatible Artifact Recipes And Results

Status: completed

Priority: P1

Suggested agent: TypeScript package API designer

Dependencies: none

Primary ownership:

- `packages/publish-package/src/plan.ts`
- `packages/publish-package/src/index.ts`
- focused type and plan tests in `packages/publish-package/test/index.test.ts`

Finding:

The current plan represents one build output and `publishPackage` returns `void`. The Angular use case requires two isolated outputs with different names, build inputs, generated exports, validators, and tarballs, while React needs the existing single flattened output. A generic artifact recipe and prepared-result contract is required before orchestration can be separated safely.

References:

- `packages/publish-package/src/plan.ts:22-101`
- `packages/publish-package/src/publish.ts:30-118`
- `packages/publish-package/src/index.ts:65-73`
- `/home/jahn/projects/shadcn-theme/scripts/publish.mjs:172-228`

Implementation requirements:

1. Define an opt-in artifact recipe API that can express an artifact id, final package name, isolated stage location, structured build/preparation work, a generated manifest overlay, post-manifest validation, and whether an exact tarball is required. Function hooks may be supported through ESM/CJS config; JSON config does not need to express executable callbacks.
2. Pass hooks a constrained context containing absolute package/root/stage paths, target version, artifact id/name, and the injectable runner. Do not expose mutable internal plan objects.
3. Define a `PreparedPackageArtifact` result containing at least artifact id, package name, target version, stage directory, and optional tarball path.
4. Add `prepareOnly?: boolean` and a safety-named private-template opt-in to options and resolved plans. Defaults must remain `false`.
5. Keep the default implicit recipe equivalent to today's one-artifact path, including `additionalNames` sequencing. Do not force existing API/config consumers to define recipes.
6. Reject duplicate artifact ids, duplicate package names, empty names, non-contained stage paths, incompatible combinations, and private manifests without the explicit opt-in during preflight before build or writes.
7. Keep generated manifests public-safe: enabling the private-template opt-in authorizes the source template as input but must never carry `private: true` into output.
8. Export the stable option, recipe, context, plan, and result types from the package root.

Acceptance criteria:

- Existing options resolve to one implicit artifact and retain current defaults and privacy refusal.
- A private source manifest fails before side effects unless the explicit opt-in is true; opt-in planning succeeds and the generated release manifest has no `private` field.
- Two recipes resolve to distinct, contained stages and deterministic order; duplicate ids/names and escaping paths fail in preflight.
- Type tests or compile-time fixture usage demonstrate a repository adapter can define plain and `tw` artifacts without framework-specific toolkit fields.
- `pnpm --filter @repo-toolkit/publish-package test` passes.

Completion evidence:

- Changed files: `packages/publish-package/src/plan.ts` (new `PackageArtifactRecipe`, `PackageArtifactContext`, `PackageArtifactHook`, `PackageArtifactManifestOverlay`, `ResolvedPackageArtifact`, `PreparedPackageArtifact` types; `artifacts`/`prepareOnly`/`allowPrivateTemplate` options and plan fields; `resolveArtifactContext`; preflight validation for duplicate ids/names, empty names, escaping/absolute stage dirs, recipes+`additionalNames` incompatibility, and private manifests without the opt-in; preplanning assertion that a private template's generated manifest omits `private`), `packages/publish-package/src/index.ts` (re-exports), `packages/publish-package/test/index.test.ts` (new `resolvePublishPackagePlan artifacts` suite, 9 tests).
- Recipe API shape decision: callbacks as functions on the recipe object (`build`, `validate`, `manifestOverlay` may be a function or static object), resolvable from ESM/CJS config. Hooks receive the constrained `PackageArtifactContext` only; no internal plan objects are exposed. Shell-free invocations stay with `ProcessRunner.run`; no string templating introduced.
- No hook execution wired yet — lifecycle orchestration is deferred to ARTIFACT-03; plan resolution only resolves and validates recipes.
- Verification run from repo root on 2026-09-02: `pnpm --filter @repo-toolkit/publish-package test` (3 files, 123 tests passed), `pnpm lint` (clean), `pnpm typecheck` (clean).
- No framework-specific names in toolkit source; `plain`/`tw` appear only in tests.

### Task ARTIFACT-02: Add Strict Explicit And Registry-Derived Version Resolution

Status: completed

Priority: P1

Suggested agent: npm registry and semver engineer

Dependencies: none

Primary ownership:

- a focused version module under `packages/publish-package/src/`
- `packages/publish-package/src/plan.ts`
- `packages/publish-package/src/runner.ts`
- focused version tests under `packages/publish-package/test/`

Finding:

The toolkit accepts non-empty version strings after stripping `v` and cannot capture subprocess output. The target consumer requires valid semver and `major`, `minor`, or default-patch calculation from the registry while treating only confirmed package absence as an initial release.

References:

- `packages/publish-package/src/plan.ts:201-219`
- `packages/publish-package/src/helpers.ts:35-41`
- `packages/publish-package/src/runner.ts:19-48`
- `/home/jahn/projects/shadcn-theme/scripts/publish.mjs:53-108`
- `/home/jahn/projects/shadcn-theme/packages/angular/test/release.test.mjs:69-107`

Implementation requirements:

1. Validate every explicit and manifest-derived release version as semver after removing one leading `v`; fail before build/staging/npm publication.
2. Add a mutually exclusive version strategy for explicit, major, minor, or patch selection. Preserve today's source-manifest fallback when no bump strategy is requested; CLI behavior may choose patch-by-default only when registry lookup is explicitly enabled.
3. Resolve registry bumps with `npm view <package-name> version --json`, honoring configured registry where applicable and using the base source package name rather than querying every artifact variant.
4. Classify npm-unavailable, authentication, timeout, network, registry, confirmed package-absence, and unknown failures. Only a confirmed package-absence response may use `0.0.0` as the prior version.
5. Reject malformed JSON, non-string responses, invalid versions, and ambiguous/multiple bump selections.
6. Extend process capture without breaking existing `ProcessRunner` implementations used by current consumers/tests. A new optional capability or compatible companion interface is preferable to making all existing runners implement a new required method.
7. Preserve shell-free executable/argument invocation and redact credentials or OTP values from errors.
8. Decide the semver implementation before coding: either approve a direct standards-compliant runtime dependency or document and thoroughly test a no-dependency implementation. Do not ship a partial regex that accepts versions npm would reject.

Acceptance criteria:

- Explicit `v1.2.3` resolves to `1.2.3`; `not-a-semver` fails before any runner side effect.
- Registry version `1.2.3` resolves to `2.0.0`, `1.3.0`, or `1.2.4` for the selected strategy.
- Confirmed absence plus patch resolves to `0.0.1`; E401/E403, misleading E404 authentication output, timeouts, network failures, registry failures, missing npm, malformed JSON, and invalid registry versions are fatal.
- Tests use an injected capture runner and never contact a registry.
- Existing fake runners and default explicit-version publishing remain source-compatible.
- `pnpm --filter @repo-toolkit/publish-package test` passes.

Completion evidence:

- Changed files: `packages/publish-package/src/version.ts` (new module: full semver 2.0.0 validation via the official semver.org regex — no runtime dependency added; `VersionBump`, `VersionFailureKind`, `VersionResolutionError` with classified `kind`, `isValidSemver`, `normalizeReleaseVersion`, `bumpVersion`, `resolveRegistryBumpVersion`, `redactSensitiveValues`), `packages/publish-package/src/runner.ts` (new optional `CapturingProcessRunner extends ProcessRunner` companion interface with `capture(...)`, `ProcessCaptureOptions`/`ProcessCaptureResult`, `isCapturingProcessRunner` guard; `defaultProcessRunner` now also implements `capture` via `spawn`; existing `ProcessRunner` implementations remain valid), `packages/publish-package/src/plan.ts` (explicit and manifest versions now semver-validated after one leading-`v` strip; new mutually-exclusive `bump?: 'major' | 'minor' | 'patch'` option; sync resolver rejects `bump`/`bump`+`version`; new async `resolvePublishPackagePlanAsync` that queries `npm view <base source name> version --json` honoring `--registry` and feeds the resolved version into the sync plan), `packages/publish-package/src/index.ts` (re-exports), `packages/publish-package/test/version.test.ts` (new suite, 30+ tests covering semver grammar, bumps, registry classification incl. misleading E404-with-auth, redaction, async plan integration; all via injected capture runners — no real registry contact).
- Semver decision: internal implementation using the official semver.org full grammar regex (zero runtime deps preserved; `semver` was not a dependency anywhere in the repo).
- Failure classification: `npm-unavailable` (spawn ENOENT / missing capture capability), `authentication` (E401/E403/auth patterns, including misleading E404 carrying auth/SSO/401/403/credentials text), `timeout` (ETIMEDOUT), `network` (ENOTFOUND/EAI_AGAIN/ECONNREFUSED/...), `registry` (E5xx), `package-absent` (E404 without auth indicators — the only kind allowed to bump from `0.0.0`), `malformed-response` (bad/empty/non-string JSON), `invalid-version` (non-semver strings), `ambiguous-selection` (version+bump conflict), `unknown` (everything else).
- Shell-free invocation preserved (`npm view <name> version --json [--registry <url>]` via argument list); registry URL credentials are redacted from error messages (`://user:pass@` → `://[redacted]@`).
- Verification run from repo root on 2026-09-02: `pnpm --filter @repo-toolkit/publish-package test` (4 files, 160 tests passed), `pnpm lint` (clean), `pnpm typecheck` (clean).
- Notes for follow-ups: ARTIFACT-03 should call `resolvePublishPackagePlanAsync` instead of `resolvePublishPackagePlan` so `bump` works through `publishPackage`; ARTIFACT-05 can expose `--bump major|minor|patch` mapping to `options.bump` (CLI patch-by-default only when registry lookup is explicitly enabled); `get plan.bump` is not recorded on the plan — consumers needing the requested strategy should read `options.bump`.

### Task ARTIFACT-03: Separate Artifact Preparation From Publication

Status: completed

Priority: P0

Suggested agent: release pipeline and filesystem safety engineer

Dependencies: ARTIFACT-01

Primary ownership:

- `packages/publish-package/src/publish.ts`
- optional focused preparation module under `packages/publish-package/src/`
- `packages/publish-package/src/index.ts`
- focused lifecycle tests under `packages/publish-package/test/`

Finding:

The current loop writes a name and calls npm immediately. That sequencing cannot guarantee that a failed second artifact prevents publication of the first, and `dryRun` cannot provide retained inspectable artifacts without calling npm publish.

References:

- `packages/publish-package/src/publish.ts:30-118`
- `packages/publish-package/src/publish.ts:126-151`
- `/home/jahn/projects/shadcn-theme/packages/angular/test/release.test.mjs:109-139`

Implementation requirements:

1. Introduce a preparation phase that creates every isolated stage, runs each recipe's build/preparation hook, copies configured package/root files, writes the final per-artifact manifest, applies any manifest overlay, runs validation, and optionally packs the stage.
2. Do not invoke `npm publish` until every selected artifact has completed preparation, validation, and required packing successfully.
3. Add a public preparation API if necessary so `prepareOnly` can return `PreparedPackageArtifact[]` without publication. `publishPackage` may return the same results after publishing rather than remaining `void`.
4. Implement exact packing with `npm pack --json --ignore-scripts --pack-destination <dir>`. Parse the response defensively, require exactly the expected safe basename-only filename, and verify that the tarball exists inside the configured artifact output directory.
5. Publish the exact tarball when an artifact was packed; otherwise retain the existing directory publication path for the implicit/default artifact.
6. Preserve requested stages/tarballs for prepare-only and explicit artifact-output configurations. Clean temporary internal staging in `finally` without deleting consumer-selected retained outputs or original build output.
7. Keep npm access, tag, registry, provenance, dry-run, and OTP-environment behavior consistent for every artifact. `prepareOnly` must make zero `npm publish` calls; it is distinct from npm `dryRun`.
8. Preserve path containment, copy collision checks, regular-file checks, executable bits, safe symlink handling, and sensitive-error redaction across every stage.
9. Produce errors that identify the artifact id/name and lifecycle phase while preserving the original cause.

Acceptance criteria:

- A two-artifact fixture whose second validator fails performs zero npm publish calls and leaves no unsafe partial temporary staging.
- Prepare-only returns two records with distinct manifests/stages and existing exact tarballs, and invokes no npm publish command.
- A normal two-artifact run prepares and packs both before its first publish, then publishes the exact returned tarballs in deterministic order.
- Unsafe npm pack filenames, malformed pack JSON, missing tarballs, stage escapes, and generated symlink escapes fail without publication.
- Existing one-artifact callers retain flattened/preserved layout behavior, additional-name behavior, npm flags, and cleanup guarantees.
- Tests use fake runners or local controlled archives and never publish or query a real registry.
- `pnpm --filter @repo-toolkit/publish-package test` passes.

Completion evidence:

- Changed files: `packages/publish-package/src/prepare.ts` (new module: `prepareArtifacts` preparation phase with `PrepareSession`/`PreparedArtifactEntry`, per-recipe staging with absolute containment + empty-or-absent stage guarantee, build/validate hook invocation with the constrained `PackageArtifactContext`, per-artifact manifest generation with recipe package name, minimal manifest-overlay seam (plain-object, rejects `private`), exact `npm pack --json --ignore-scripts --pack-destination <dir>` packing with defensive JSON parsing, basename-only + expected-name verification, tarball existence/containment check, artifact id/name + lifecycle-phase error wrapping with preserved `cause`, and the moved copy/collision/symlink/executable-bit filesystem helpers), `packages/publish-package/src/publish.ts` (now async; `publishPackage` returns `Promise<PreparedPackageArtifact[]>`, routes through `resolvePublishPackagePlanAsync`, runs the full preparation phase for every artifact before the first `npm publish`, publishes exact tarballs for packed recipes and retains the directory path + `additionalNames` manifest sequencing for the implicit artifact, `prepareOnly` performs manifest writes but zero npm calls; new public `preparePackageArtifacts` == `publishPackage({ ...options, prepareOnly: true })`; OTP still via `npm_config_otp` env only, access/tag/registry/provenance/dry-run flags identical for directory and tarball publishes), `packages/publish-package/src/plan.ts` (plan gains `hasExplicitRecipes`), `packages/publish-package/src/index.ts` (exports `preparePackageArtifacts`), `packages/publish-package/src/cli.ts` (`await publishPackage`), `packages/publish-packages/src/index.ts` + `src/cli.ts` (async propagation of the new `publishPackage` contract), `packages/publish-package/test/prepare.test.ts` (new lifecycle suite, 9 tests), `packages/publish-package/test/index.test.ts`, `packages/publish-package/test/artifact-layout.test.ts`, `packages/publish-packages/test/index.test.ts` (await/rejects updates required by the documented async API evolution).
- Preparation boundary: `prepareArtifacts` completes staging, build hooks, copies, manifests (+overlays), validation, and required packing for EVERY artifact before any `npm publish` runs; a failing second validator yields zero publish/pack-for-later calls and wraps the error with artifact id/name, phase, and `cause`.
- Packing: fake capturing runner synthesizes `npm pack --json` payloads and controlled local tarball files; tests cover unsafe filenames (`../` traversal), unexpected names, malformed JSON, missing tarballs, non-capturing runners, ordering (both packs precede the first publish), exact tarball argv on publish, and identical npm flags/OTP env for every artifact. No real registry contact.
- Retention/cleanup: recipe stage dirs and tarballs are retained (prepare-only and publish runs); recipe stages must start empty or absent (contamination guard); preserve-mode temp staging is removed in `finally` except under `prepareOnly`; the implicit flattened/preserved layouts and the original publish dir are untouched.
- Verification run from repo root on 2026-09-02: `pnpm --filter @repo-toolkit/publish-package test` (5 files, 169 tests passed), `pnpm lint` (clean), `pnpm typecheck` (clean), `pnpm --filter @repo-toolkit/publish-packages test` (3 files, 85 tests passed). Serialized per the concurrency rule.
- Notes for follow-ups: ARTIFACT-04 owns the manifest overlay policy — the seam currently applies a shallow plain-object merge rejecting only `private` (see `resolveManifestOverlay` in `src/prepare.ts`) and may tighten validation without moving the call site; recipe manifests are generated with `preservePublishDir: false` (stage dir is the publish root); pack destination is `dirname(stageDir)`; ARTIFACT-06 can model the two-variant flow via recipes with `build`/`validate` hooks and `requireTarball: true`, using a fake `CapturingProcessRunner` as in `test/prepare.test.ts`.

### Task ARTIFACT-04: Support Safe Per-Artifact Manifest Completion

Status: completed

Priority: P1

Suggested agent: npm manifest contract engineer

Dependencies: ARTIFACT-01

Primary ownership:

- `packages/publish-package/src/manifest.ts`
- preparation integration in `packages/publish-package/src/publish.ts` or its replacement
- focused manifest tests in `packages/publish-package/test/index.test.ts`

Finding:

The target manifests require placeholder-aware author inheritance, consumer-selected `files`, `publishConfig.access`, and an Angular generated exports map that exists only after building a stage. Current generation overwrites `files`, inherits author only when absent, and can only rewrite source-manifest exports.

References:

- `packages/publish-package/src/manifest.ts:7-25`
- `packages/publish-package/src/manifest.ts:49-130`
- `/home/jahn/projects/shadcn-theme/scripts/publish.mjs:13-32`
- `/home/jahn/projects/shadcn-theme/scripts/publish.mjs:110-149`
- `/home/jahn/projects/shadcn-theme/scripts/publish.mjs:189-193`

Implementation requirements:

1. Treat an `author` equal to the configured metadata placeholder like absent author and inherit the root value, matching existing license/repository placeholder handling.
2. Make the generated `files` policy configurable so a recipe can preserve a validated source allow-list while the current safe default `['**/*', '!**/*.map']` remains unchanged.
3. Support injecting `publishConfig.access` when requested, without relying on it as a substitute for the existing npm `--access` argument.
4. Allow each artifact to supply a plain-object manifest overlay after build and before validation. Validate overlay shape and explicitly control protected fields such as name, version, private, scripts, package manager, and dev dependencies.
5. Permit a generated exports map to replace source exports and run it through the same shape/path validation required for source exports. The temporary overlay source file must not leak into the packed artifact when a recipe consumes one.
6. Preserve dependency/version-placeholder rewriting and final rejection of unresolved workspace ranges after overlays are applied.
7. Decide and document whether artifact overlays use a strict allow-list or protected-field deny-list. The selected policy must reproduce shadcn's public manifest surface without weakening defaults for existing consumers.

Acceptance criteria:

- `author: "PLACEHOLDER"` inherits root author and no placeholder remains in the result.
- A React-like fixture can preserve its source `files` array and receive `publishConfig: { access: 'public' }` while default toolkit fixtures retain the current generated files field.
- Plain and `tw` fixtures receive distinct generated exports maps; every target is validated and the intermediate overlay file is absent from packed contents.
- Attempts to overlay `private`, scripts, dev dependencies, package manager, a conflicting version, or an invalid exports shape fail before validation/publish.
- Existing manifest rewrite tests remain valid unless explicitly extended for the new opt-in policies.
- `pnpm --filter @repo-toolkit/publish-package test` passes.

Completion evidence:

- Changed files: `packages/publish-package/src/manifest.ts` (author now resolves through the same `resolvePlaceholderField` placeholder rule as license/repository — `author: "PLACEHOLDER"` inherits the root author and is omitted when no root value exists; new `rewrite.preserveSourceFiles` option preserving a validated source `files` allow-list (non-array-of-strings rejected) while the default `['**/*', '!**/*.map']` is unchanged; new `publishAccess` option injecting `publishConfig.access` (merged with any existing plain-object publishConfig; npm still passes `--access` separately); new exported `applyManifestOverlay` + `OVERLAY_DENIED_FIELDS` + `ManifestOverlayPolicyContext` implementing the overlay policy: protected-field DENY-LIST rejecting `private`/`scripts`/`devDependencies`/`packageManager` always, `version` on conflict with the plan release version, `name` on conflict with the artifact package name, `exports` validated with the same `validateExportsShape` used for source manifests, `files` must be an array of strings, dependency fields must be string-range maps, and after merging, dependency/version-placeholder rewriting is re-applied and `validatePublishManifestFields` re-runs so no `workspace:`-unresolved or placeholder range can be smuggled in), `packages/publish-package/src/plan.ts` (recipe fields `preserveSourceFiles` + `publishAccess`, option/plan field `publishAccess`, plan-time validation of recipe `publishAccess`), `packages/publish-package/src/prepare.ts` (recipe manifest generation now passes `preserveSourceFiles`/`publishAccess`; the overlay seam keeps only the plain-object check and delegates all field policy to `applyManifestOverlay`; lifecycle unchanged — overlay still applied after build, before validation/pack/publish), `packages/publish-package/src/index.ts` (new exports), `packages/publish-package/test/index.test.ts` (new createPublishPackageJson cases: author placeholder inherit/omit/preserve-local, preserveSourceFiles valid/invalid, publishConfig.access injection/omission; fixture mkdtemp prefixes renamed off the `repo-toolkit-publish-` staging prefix to remove a latent cross-file tmpdir-scan race exposed by adding a sixth test file), `packages/publish-package/test/manifest-overlay.test.ts` (new focused suite, 7 tests: preserved files + publishConfig.access recipe fixture, default files policy unchanged, invalid preserved files rejected pre-publish, two-variant fixtures with distinct generated exports maps and the intermediate overlay-source file absent from stage/pack contents, deny-list + version/name conflict + invalid exports shape + invalid files + smuggled `workspace:*` all rejected before any publish, equal name/version accepted, overlay dependency placeholder rewritten to the release version).
- Overlay policy decision (Deferred Decision resolved): **protected-field deny-list**, not a strict allow-list. Rationale: the consumer's public manifest surface is open-ended (description, keywords, exports, publishConfig, files, dependency-map adjustments), so an allow-list would need constant maintenance and would block legitimate new fields; the release-safety boundary is a small stable set of protected fields plus shape checks and a post-merge re-validation pass. Documented in the `applyManifestOverlay` JSDoc in `src/manifest.ts`.
- Exports overlay validation: overlays run through the exact same `validateExportsShape` used by `validateSourceManifest`, applied inside `applyManifestOverlay` so function and static overlays are checked identically before merge.
- The intermediate overlay-source file never enters the stage: overlay hooks only return data; the test writes the intermediate file next to (not inside) the stage and asserts no `.overlay-source-*` entry exists in either packed stage.
- Verification run from repo root on 2026-09-02 (serialized): `pnpm --filter @repo-toolkit/publish-package test` (6 files, 183 tests passed, run twice for stability), `pnpm lint` (clean), `pnpm typecheck` (clean), `pnpm --filter @repo-toolkit/publish-packages test` (3 files, 85 tests passed — unchanged behavior confirmed).
- Notes for follow-ups: ARTIFACT-05 can expose `--publish-access` / JSON-safe `preserveSourceFiles` flags (callback overlays remain ESM/CJS-only); ARTIFACT-06 can combine `preserveSourceFiles`, `publishAccess: 'public'`, and per-variant `manifestOverlay` exports hooks with `requireTarball` to model both consumer flows.

## Wave 3: Entry Points And Consumer Coverage

### Task ARTIFACT-05: Expose Generic CLI And Config Controls

Status: completed

Priority: P2

Suggested agent: TypeScript CLI and documentation engineer

Dependencies: ARTIFACT-02, ARTIFACT-03, ARTIFACT-04

Primary ownership:

- `packages/publish-package/src/cli.ts`
- `packages/publish-package/test/cli.test.ts`
- `packages/publish-package/README.md`
- `website/docs/packages/publish-package.md`

Finding:

The CLI exposes explicit versions and npm dry-run but no bump selection, private-template opt-in, or prepare-only mode. JavaScript config is the practical place for package-specific recipe hooks, but generic lifecycle controls still need stable flags, help, precedence tests, and documentation.

References:

- `packages/publish-package/src/cli.ts:15-109`
- `packages/publish-package/src/cli.ts:127-159`
- `packages/publish-package/README.md:11-44`
- `packages/publish-package/README.md:60-142`

Implementation requirements:

1. Add CLI flags for registry bump selection, prepare-only, and private-template opt-in. Use safety-explicit wording for private templates; do not call it a generic `--force` flag.
2. Keep bump flags mutually exclusive and define precedence between CLI explicit version, CLI bump, and config values. Invalid combinations must fail before prompting or subprocess execution.
3. Load artifact recipe callbacks from ESM/CJS configs. Emit a clear error if JSON config attempts to express an unsupported executable recipe shape.
4. Document prepare-only versus npm dry-run, retained artifact paths, all-artifacts-before-publish behavior, generated overlay restrictions, registry failure policy, and private-template risk.
5. Include a generic ESM config example modeling one standard artifact and two variant artifacts without using shadcn-specific names in the primary API documentation.
6. Keep CLI help, README flag lists, parser specs, and tests in parity. Preserve strict unknown-argument behavior and config-to-CLI override semantics.
7. Correct the existing README statement that `--` terminates parsing if the implementation and current tests still intentionally continue parsing after `--`; do not weaken tests to match inaccurate documentation.
8. Update website documentation in its standalone project and run its own applicable verification command without installing it from workspace root.

Acceptance criteria:

- CLI tests cover explicit/bump conflicts, prepare-only, private-template opt-in, config callbacks, config precedence, help output, and nonzero failure behavior.
- Prepare-only is documented and demonstrably invokes no npm publish, while dry-run is documented as invoking `npm publish --dry-run`.
- The private-template opt-in is visibly exceptional and default refusal remains documented.
- Existing flags and config formats continue to work.
- `pnpm --filter @repo-toolkit/publish-package test`, `pnpm lint`, and `pnpm typecheck` pass.
- The applicable standalone website lint/build command passes or a concrete blocker is recorded.

Completion evidence:

- Changed files: `packages/publish-package/src/cli.ts` (new SPECS entries `--bump <major|minor|patch>`, `--publish-access`, `--prepare-only`, `--allow-private-template` with matching help text and `buildOptions` mappings; exported `assertVersionSelection` — version/bump mutual exclusion across CLI+config and bump-value validation, run before any prompt or subprocess — and `assertJsonConfigRecipesDeclarative` — JSON configs naming `build`/`validate` hooks or a non-object `manifestOverlay` fail with a message directing the user to a `.mjs`/`.cjs` config; both checks wired into `main` after config merge, before prompting/publishing), `packages/publish-package/test/cli.test.ts` (new describe blocks: flag parsing incl. `--bump=minor` equals form; version-selection validation; ESM config loading hooks via default export and via named `artifacts` export; JSON-config hook/overlay rejection and declarative-recipe allowance; config→CLI precedence (`--bump` overrides config `bump`; config `bump` + CLI `--version` is a conflict); prepare-only vs dry-run with fake runner — prepare-only makes zero npm calls, dry-run invokes `npm publish --dry-run`; subprocess misuse tests asserting exit code 1 for version+bump conflict, invalid bump, and unknown flags; SPECS/help/README parity sets updated), `packages/publish-package/README.md` (new flag list entries; corrected the inaccurate `--` statement — `parseFlags` skips bare `--` and continues parsing, unknown flags after `--` still rejected; new sections "Version selection", "Prepare-only vs npm dry-run", "Private source templates", "Artifact recipes" with a generic `widget`/`widget-min`/`widget-debug` ESM config example; Options list extended with `bump`, `publishAccess`, `prepareOnly`, `allowPrivateTemplate`, `artifacts`), `website/docs/packages/publish-package.md` (flags table rows, version-selection/prepare-only/private-template sections, recipes section with the same generic example and overlay deny-list + JSON-config limitation).
- Flag/precedence rules: CLI values override config values for the same field; `--version` and `--bump` are mutually exclusive regardless of source and invalid values/combinations fail before prompting and before any subprocess. `--allow-private-template` is deliberately safety-named (no generic `--force`).
- Docusaurus website verification: `website/node_modules` was present; ran `pnpm --dir website build` from the workspace root — static build succeeded (no install in `website/`).
- Verification run from repo root on 2026-09-02: `pnpm --filter @repo-toolkit/publish-package test` (6 files, 202 tests passed), `pnpm lint` (clean), `pnpm typecheck` (clean).
- Notes for ARTIFACT-06: the CLI layer now exercises `assertVersionSelection` / `assertJsonConfigRecipesDeclarative` directly from `../src/cli`; alias imports (`@repo-toolkit/publish-package`) resolve to `src` via tsconfig paths, so no dist dependency for helpers — only the subprocess misuse tests use `dist/cli.js`. The fake-runner prepare-only/dry-run fixtures (`makeFixture` + `recordingRunner` in `test/cli.test.ts`) are a compact pattern reusable for ARTIFACT-06's CLI-level checks; the task file's own acceptance for ARTIFACT-06 (React-like/Angular-like fixtures) still needs its dedicated fixture test file.

### Task ARTIFACT-06: Prove Shadcn-Compatible React And Angular Flows

Status: completed

Priority: P1

Suggested agent: package artifact integration engineer

Dependencies: ARTIFACT-02, ARTIFACT-03, ARTIFACT-04

Primary ownership:

- a dedicated integration fixture/test under `packages/publish-package/test/`
- focused artifact layout tests under `packages/publish-package/test/`

Finding:

Generic unit tests can pass while failing the actual consumer contract: private template input, placeholder metadata, React source exports/files, Angular per-variant generated exports, validation ordering, retained exact tarballs, and registry bump classification must work together.

References:

- `/home/jahn/projects/shadcn-theme/scripts/publish.mjs:74-259`
- `/home/jahn/projects/shadcn-theme/packages/react/package.json:2-161`
- `/home/jahn/projects/shadcn-theme/packages/angular/package.json:2-90`
- `/home/jahn/projects/shadcn-theme/packages/angular/test/release.test.mjs:69-172`
- `packages/publish-package/test/artifact-layout.test.ts`

Implementation requirements:

1. Add self-contained fixtures that model the current shadcn metadata and lifecycle without importing or mutating `/home/jahn/projects/shadcn-theme`.
2. Cover a React-like private template producing one flattened package with inherited author/license, preserved source files allow-list and exports, public publish config, package README/root LICENSE/optional llms file, and no release-only source fields.
3. Cover an Angular-like private template producing deterministic plain and `tw` package names from repository-supplied recipes, distinct stages and generated exports, per-stage validation, and exact retained tarballs.
4. Assert the second Angular-like validation failure prevents every publish. Assert success packs both before publication and publishes the exact tarballs.
5. Inspect tarball contents to prove required manifests, exports targets, README/LICENSE, and build files are present and that private/scripts/dev dependencies/recipe metadata/overlay files/source/tests/maps/temp names do not leak.
6. Exercise explicit and registry-derived versions, confirmed initial release, malformed registry output, prepare-only, npm dry-run, opaque OTP environment forwarding, and nonzero CLI failure.
7. Use fake registry/publish runners and local controlled packing. No test may contact npm or depend on the external consumer repository being present.

Acceptance criteria:

- The React-like prepared manifest satisfies the modeled validator contract and its packed/imported artifact resolves declared entries.
- The Angular-like prepare-only result contains two inspectable tarballs with correct names, version, per-variant exports, and no publish calls.
- A later variant failure causes zero publication; a successful run's first publish occurs only after both pack calls.
- Sensitive values are absent from argv, logs, and surfaced error messages.
- `pnpm --filter @repo-toolkit/publish-package test` passes.

Completion evidence:

- Changed files: `packages/publish-package/test/consumer-flows.test.ts` (self-contained private-template consumer fixtures and local archive runner), `docs/tasks/20260902-102251-configurable-package-artifact-publishing.md` (this completion record).
- Scenarios: flattened public single-artifact flow with inherited placeholder metadata, preserved files/exports, copied release files and manifest validation; deterministic two-artifact generated overlays and validators; retained exact tarballs; all-packs-before-publish, second-validator zero-publish, prepare-only, dry-run, OTP environment forwarding, explicit and registry bump versions, clean E404 initial version, malformed registry JSON, and existing CLI misuse coverage.
- Tar mechanism: test runner determines availability with `command -v tar`; when present it creates and extracts genuine local gzip tarballs with that executable and verifies manifests, entry targets, release files, build files, and excluded release-source/temporary content. Archive inspection assertions are skipped gracefully when unavailable.
- Verification run from repo root on 2026-09-03: `pnpm --filter @repo-toolkit/publish-package test` (7 files, 207 tests passed), `pnpm lint` (clean), `pnpm typecheck` (clean).

## Wave 4: Independent Integration Review

### Task ARTIFACT-07: Review Public Contract And Release Boundaries

Status: completed

Priority: P1

Suggested agent: independent npm release safety reviewer

Dependencies: ARTIFACT-05, ARTIFACT-06

Primary ownership:

- review of all files changed by ARTIFACT-01 through ARTIFACT-06
- supplemental focused tests only where an acceptance gap is found
- completion evidence in this task document

Finding:

This change expands a release engine across process capture, public callbacks, private source templates, filesystem staging, manifest overlays, tarball parsing, and multi-artifact sequencing. It requires an independent review against runtime artifacts, not only implementation structure.

References:

- `AGENTS.md`
- `packages/publish-package/src/plan.ts`
- `packages/publish-package/src/manifest.ts`
- `packages/publish-package/src/publish.ts`
- `packages/publish-package/src/runner.ts`

Implementation requirements:

1. Independently verify every prior acceptance criterion and compare the resulting fixture behavior with `/home/jahn/projects/shadcn-theme/scripts/publish.mjs` and its release tests.
2. Confirm no framework-specific names or behavior entered toolkit source and that a repository adapter/config can express both consumer contexts.
3. Confirm current callers retain default privacy refusal, one-artifact behavior, layouts, additional names, npm controls, and runner compatibility.
4. Inspect packed artifacts and extracted consumers to ensure public manifests, entry paths, tar contents, and executable modes agree and no internal data crosses the package boundary.
5. Review all path inputs, callback outputs, overlay fields, npm JSON responses, registry failures, and cleanup paths as untrusted boundaries.
6. Confirm the prepare-all boundary across artifacts and accurately document that npm publication itself is not transactionally rollback-safe.
7. Run targeted checks before full repository checks. Serialize package tests that rebuild shared dependency outputs.

Acceptance criteria:

- No unresolved P0/P1 finding remains, or each blocker is recorded with owner and residual risk.
- Public types, CLI/config behavior, implementation, README, website documentation, and produced artifacts agree.
- No test contacts a real npm registry or publishes a package.
- `pnpm --filter @repo-toolkit/publish-package test` passes.
- If `publish-packages` metadata or forwarding changed, `pnpm --filter @repo-toolkit/publish-packages test` passes; otherwise its behavior is confirmed unchanged.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass.
- Applicable standalone website verification passes or a concrete blocker is recorded.

Completion evidence:

- Independent ARTIFACT-01 through ARTIFACT-06 review covered public types, CLI/config, version and registry classification, runner compatibility, manifest overlays, filesystem containment and cleanup, packing, publication ordering, consumer-flow fixtures, README/website documentation, and the read-only modeled `shadcn-theme` release script/tests.
- Fixed two P0 preparation-boundary gaps in `packages/publish-package/src/prepare.ts`: failed preserved-layout preparation now cleans its internally created temporary stage, and recipe-produced symlinks must resolve inside both the package and artifact stage before copies or packing. Added focused regression tests in `packages/publish-package/test/prepare.test.ts`.
- Confirmed source-only toolkit scan contains no `react`, `angular`, `shadcn`, `tw`, or `exports.json` behavior; package tests use injected runners/local archives and make no real registry or npm publish calls.
- Serialized checks passed on 2026-09-03: `pnpm --filter @repo-toolkit/publish-package test` (209 tests), `pnpm --filter @repo-toolkit/publish-packages test` (85 tests), `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
- Website `node_modules` was present; standalone `pnpm --dir website build` passed without installation.
- No unresolved P0/P1 findings. npm publication remains intentionally non-transactional after the all-artifacts-prepared boundary, as documented.

## Dependencies And Parallelization

- ARTIFACT-01 and ARTIFACT-02 may proceed in parallel if they coordinate changes to `plan.ts`, `runner.ts`, and root exports before merging.
- ARTIFACT-03 depends on the recipe/result contract from ARTIFACT-01.
- ARTIFACT-04 may proceed after ARTIFACT-01 in parallel with ARTIFACT-03, but both modify the manifest-to-stage boundary and must agree on overlay timing.
- ARTIFACT-05 starts after the lifecycle and version options stabilize. ARTIFACT-06 can begin fixture design earlier but should assert the final API only after ARTIFACT-02 through ARTIFACT-04 complete.
- ARTIFACT-07 must be performed by someone other than the primary lifecycle implementer.
- `packages/publish-package/src/plan.ts`, `src/index.ts`, `src/publish.ts`, `test/index.test.ts`, package builds, and generated `dist/` outputs are shared hotspots. Do not run recursive builds/tests concurrently when they rebuild the same dependency closure.

## Deferred Decisions

- Semver implementation: approve a direct runtime dependency or require a complete tested internal implementation before ARTIFACT-02 starts. This decision blocks only the version module, not artifact-contract design.
- Recipe API shape: choose callbacks versus declarative structured command recipes during ARTIFACT-01. The selected design must be usable from ESM/CJS config, keep new executable invocations shell-free, and avoid unsafe string templating.
- Retained artifact root: choose a safe configurable output root and collision policy during ARTIFACT-01/03. It must support shadcn's inspectable prepare-only flow without allowing escape from the package root.
- Manifest overlay policy: choose strict allow-list versus protected-field deny-list during ARTIFACT-04 and document the external contract. Protected release-safety fields cannot be overridden either way.
- `publish-packages` forwarding is deferred until the single-package API is stable and a workspace consumer requires it. The shadcn use case should use `publish-package` because its framework packages are separate workspaces and need distinct recipes.

## Definition Of Done

- `@repo-toolkit/publish-package` can express the current shadcn React and Angular release flows through generic config/adapter primitives with no framework-specific toolkit code.
- Private template publishing is explicit, preflighted, and cannot leak `private` or other release-only fields.
- Versions are semver-valid; explicit and registry bump paths classify failures safely and never treat ambiguous registry errors as package absence.
- Every artifact is independently staged, manifest-completed, validated, and optionally packed before any npm publish begins.
- Prepare-only returns retained inspectable artifacts and makes no publish call; npm dry-run remains a distinct behavior.
- Packed artifacts and generated manifests agree, exact validated tarballs are published, OTP stays out of argv/logs, and all staging/copy/overlay paths remain contained.
- Existing single-package behavior remains the default and `publish-packages` has no regression.
- Package docs and website docs describe the stable contract and its safety boundaries.
- Targeted package tests, full lint/typecheck/tests, controlled artifact/consumer verification, and independent review pass with completion evidence recorded in this file.
