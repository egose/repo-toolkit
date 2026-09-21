# Secret Sync: Direct 1Password SDK Backend

Created: 2026-09-20 15:24:44 (local timestamp)

Status: implementation complete (SDK-DIRECT-01 through SDK-DIRECT-07); final live verification (SDK-DIRECT-08) blocked on credentials/desktop — see task evidence. No code changes in SDK-DIRECT-08.

Related objective: [Secret Sync Package](20260920-100015-secret-sync-package.md). This is a new phase extending the implemented package. It promotes the original plan's deferred SDK/service-account/desktop-auth backend into executable work; larger attachments/Documents remain deferred.

## Objective And Scope

Allow every existing secret-sync workflow to operate against 1Password **without a Connect server**, using the official `@1password/sdk` JavaScript package. Deliver service-account authentication for CI/headless environments and desktop-app authentication for local use through the existing `@repo-toolkit/secret-sync` package and CLI.

Reuse the existing file selection, immutable records, history graph, conflict detection, push/pull, single-file restore/rollback, and branch operations. Keep Connect available as an explicitly selected backend. Direct operation must not require Connect environment variables, Docker, the `op` CLI, or a running Connect endpoint.

Non-goals: hand-writing requests to undocumented 1Password cloud endpoints, implementing account cryptography, master-password/Secret-Key login, provisioning accounts/vaults, OIDC/workload identity preview support, larger-file encoding, cross-vault migration, pruning history, and adding another package or executable.

This change request is for a task document. No implementation or dependency installation accompanies it.

## Inspected Evidence And Baseline

Repository inspection on 2026-09-20:

- `packages/secret-sync/src/types.ts:17-22` and `config.ts:161-179`: remote configuration only accepts `onepassword-connect`, including a required resolved host/token environment-variable pair.
- `src/store.ts:5-47`: `SecretStore` already exposes list/get/create and an uncertain-create result, but its public DTO names and field shapes are Connect-specific.
- `src/cli-options.ts:61-108`: `createSecretStoreForPlan` always constructs Connect unless a store is injected; `resolveEndpointForPlan` always requires a Connect host.
- `src/index.ts:550-605` (`runSecretSync`): endpoint resolution still occurs with an injected store; the operation dispatcher passes an HTTP endpoint to stateful commands.
- `src/state.ts:31-61,126-163`: schema-v1 state and identity are bound to HTTP endpoint + vault + project. `src/doctor.ts:97-187` reports Connect transport bounds and environment-only tokens.
- `src/init.ts:95-157`: initialization creates Connect config and conditionally binds local state from the host environment variable.
- `src/records.ts:14-18,34-69`: schema-v1 blob/commit envelopes, 32 KiB file bound, 64 KiB record bound, and Connect-shaped item inputs.
- `src/history-store.ts:95-125`: shared history loads list results then details; concurrency helpers are imported from `connect.ts`. `src/operations.ts` also imports those helpers and contains shared graph/publication logic.
- `src/errors.ts`: existing auth/rate-limit/network/timeout/uncertain-write/identity-mismatch classifications can be reused.
- `test/helpers.ts:10-48`: `MemoryFakeStore` already implements the shared contract, enabling offline workflow verification. `tsup.config.ts` builds Node 20 ESM and declaration files.
- `packages/secret-sync/package.json`: current runtime dependencies are the shared toolkit package and picomatch; the root lockfile search found no `@1password/sdk`/`sdk-core` dependency.
- `packages/release-artifact/src/index.ts`: distribution has node-modules copy/none modes; runtime dependency packaging needs an installed-artifact test, not only a successful bundle.
- Original plan SECSYNC-10 completion evidence: live Connect verification remains blocked, and a prior installed-consumer smoke failed on an unreplaced `workspace:*` dependency. Treat that as a known verification gap; a bare `--help` run is not evidence that the SDK runtime ships correctly.

External evidence fetched during this planning session:

1. [SDK authentication concepts](https://www.1password.dev/sdks/concepts/): service accounts and desktop authentication are supported. Service accounts are vault/permission scoped and cannot access built-in Personal/Private/Employee vaults. Desktop approval grants temporary access to the authorized account, which is broader than our configured vault filter.
2. [Official JavaScript SDK README](https://github.com/1Password/onepassword-sdk-js): `createClient`, service-account tokens, `DesktopAuth`, item list/get/create, concealed fields, and file support. SDK owns authentication/session handling; it is distinct from Connect SDKs.
3. [Published SDK metadata](https://registry.npmjs.org/@1password/sdk/latest): latest observed version `0.5.0`, with exact dependency `@1password/sdk-core: 0.5.0`.
4. [Published core metadata](https://registry.npmjs.org/@1password/sdk-core/latest): version `0.5.0`, main `nodejs/core.js`, Rust core built with `wasm_bindgen`, approximately 14 MB unpacked. Do not infer runtime portability or bundler compatibility from metadata alone.
5. [SDK overview](https://www.1password.dev/sdks/) and [file API](https://www.1password.dev/sdks/files/), reviewed during the parent planning session: SDK handles direct access and can upload Documents/attachments. Its file message-size limit does not establish concealed-field capacity.

Classification: these are extension boundaries and compatibility investigations, not newly established production defects. Searches found only the parent secret-sync task; no duplicate direct-backend task exists in the inspected backlog.

Baseline: `git status --short` was clean before this documentation change. No lint/typecheck/build/tests, SDK installation, account authentication, desktop approval, or live vault requests were run. API signatures/platform support from a released SDK installation, service quotas, cancellation behavior, and live record interoperability remain to be verified below. Existing parent-plan test evidence is historical, not a fresh baseline for this phase.

Document verification: `git diff --check` and `git diff --no-index --check /dev/null docs/tasks/20260920-152444-secret-sync-direct-onepassword.md` passed. Reviewed all eight task IDs/dependencies and reciprocal links; status showed only this new task file and the parent-plan follow-up link update.

## Selected Contract

### Provider And Authentication Configuration

Add a discriminated remote variant, retaining config `schemaVersion: 1` because the new provider is an additive option. Existing configs, including omitted `remote.type`, retain the existing Connect default. Never infer a backend/auth mode from whichever token happens to be set.

Service-account example (replace only `remote` in an otherwise valid existing config):

```json
{
  "remote": {
    "type": "onepassword-sdk",
    "vaultId": "<vault-id>",
    "auth": {
      "type": "service-account",
      "tokenEnv": "OP_SERVICE_ACCOUNT_TOKEN"
    }
  }
}
```

Desktop example:

```json
{
  "remote": {
    "type": "onepassword-sdk",
    "vaultId": "<vault-id>",
    "auth": {
      "type": "desktop",
      "account": "<1password-account-id-or-name>"
    }
  }
}
```

- Default `tokenEnv` only within service-account mode. Require an explicit SDK auth type. Reject Connect fields in SDK configs, SDK auth fields in Connect configs, raw token properties, and incompatible auth fields.
- Desktop account selection is explicit and delegated to the SDK. Prefer a stable account ID where supported; SDK-DIRECT-01 confirms the exact supported selector. A display-name change must not by itself invalidate a state binding to the same vault.
- Read tokens only during execution. Never persist SDK clients, tokens, decrypted item payloads, session keys, or desktop sessions in config/plans/state/results. SDK errors must not leak them through messages, causes, stacks, or diagnostic JSON.
- Desktop prompts are supplied by 1Password, not a new toolkit password prompt. A denied/cancelled prompt is an authentication error; never fall back to a different account, service token, or Connect. Headless jobs should select service-account mode explicitly.
- Planning, validation, help, and local-only `init` must not instantiate/authenticate the SDK. An online dry run may authenticate/read but must not create items or change worktree/state. Document any SDK-internal session effects separately from the tool's mutation-free dry-run guarantee.
- Create one lazily initialized SDK client per command execution, shared by concurrent store calls. Preserve `store` injection so offline tests and consumers can bypass SDK loading entirely.

### Storage And Sync Compatibility

- Keep schema-v1 Secure Note records, concealed payload fields, title/tag conventions, logical IDs, and current file/record bounds. Map SDK item categories/field properties to the normalized store model at the adapter boundary. Do not serialize SDK-native enum values into existing record payloads.
- Reuse shared `SecretStore` operations and uncertain-write reconciliation. SDK support for uploads does not require changing the file storage model merely to remove Connect.
- Records created by either backend in the same vault/project should be readable by the other after provider synchronization. Fake fixtures can prove mapping; actual cross-backend access is a separate live verification criterion.
- Preserve append-only history and derived heads. SDK availability does not establish compare-and-swap, unique-title creation, exactly-once writes, globally current listings, or multi-item transactions.
- List only the configured vault, include every relevant active item, and faithfully emulate existing title-filter behavior. Handle the actual SDK paging/iterator model, archived items, and unsupported unrelated item categories. An incomplete list or quota error must not look like an empty project.
- Apply bounded concurrency/record counts and per-record validation. SDK internals may allocate/decrypt complete responses before adapter validation; describe limits honestly rather than claim transport-streaming enforcement that the SDK does not expose.
- Service-account quotas differ from Connect. Verify SDK internal retries and cancellation before adding outer retries. A timeout around an unabortable create is an **uncertain write**, not evidence it failed. Never blindly start another create while the first may still finish; reuse logical IDs and the shared reconciliation path.

### Provider-Neutral State And Backend Changes

- Add local state schema v2 with discriminated remote identity: Connect `{ type, endpoint, vaultId }`; direct SDK `{ type, vaultId }`; project ID remains part of the enclosing identity. Direct identity is the configured vault object, accessed and verified through the SDK; it is not a fabricated Connect URL.
- Service-account token rotation and changing auth mode to another authorized identity for the same vault/project do not reset baselines. Changing provider, vault, or project is an identity mismatch. An account lacking the configured vault must fail access checks rather than selecting a similarly named vault.
- Read legacy schema-v1 state as Connect with its exact existing endpoint binding. Read-only operations must not rewrite it. On a successful state-writing operation, migrate atomically while preserving baselines, HMAC key, heads, journal position, and active/materialized branch.
- For an existing Connect worktree, a config-only provider change must refuse to reuse its state. Initial transition guidance is a fresh worktree/state directory using the same vault/project IDs; reconcile preexisting local files through the existing unbased-conflict rules. Do not automatically delete journals or reset a dirty worktree. An in-place backend-rebind command is deferred.
- Update operation APIs to accept provider-neutral identity. Preserve existing exported Connect entrypoints and legacy endpoint-based operation inputs through an explicit normalization boundary where feasible; callers must not supply conflicting identity forms. Record any unavoidable public type/result changes and release notes in SDK-DIRECT-05.

### Dependency And Distribution Decision

- Add `@1password/sdk` as a normal runtime dependency of `@repo-toolkit/secret-sync`, pinned to the exact version validated in SDK-DIRECT-01 (candidate `0.5.0`). Rationale: official direct authentication, encryption, and supported item APIs cannot be replaced by the existing generic fetch helper. No `op` executable dependency.
- Keep SDK loading lazy and retain its runtime assets through the package manager's dependency closure. Prefer leaving the SDK external to tsup rather than hand-copying or bundling wasm glue; verify this with real packed installation and the actual release-artifact layout.
- Existing toolkit Node >=20 and ES2018 typechecking targets remain required. Unsupported SDK runtime/platform combinations must be explicit, and selecting Connect must not initialize the SDK runtime.
- Same executable and command syntax for status/push/pull/log/restore/rollback/branch/switch/resolve. Extend `init` with `--provider onepassword-sdk --auth service-account` or `--provider onepassword-sdk --auth desktop --account <selector>`; keep existing `init --vault` behavior. Add `--token-env` for service-account config generation without accepting token values on argv.
- `doctor` reports the selected provider/auth mode, observed vault/read access, and applicable SDK bounds. It must not demand a Connect URL, report Connect HTTP retry constants for SDK operations, or claim write permissions were tested from a successful list.

## Shared Verification And Working Rules

Priority: P1 = necessary adapter/identity/runtime correctness; P2 = end-to-end usability and distribution verification required before release. Tasks are improvements except the bounded SDK investigation.

Follow AGENTS.md, preserve unrelated work, and update this file as execution proceeds. Record exact changed paths and verification evidence before marking tasks completed. Missing credentials/platform support makes the affected verification task blocked, not completed. No subagents are assigned. Sequence shared `index.ts`, package metadata/lockfile, and state/dispatcher changes using the dependencies below.

Repository-root checks, after `pnpm install`:

- **V1:** `pnpm lint` and `pnpm typecheck` after code changes; `pnpm test` after changes touching `src/` or `test/`.
- **V2:** `pnpm --filter @repo-toolkit/secret-sync test`, with fake SDK client factories and temporary worktrees. Tests must run without Connect, 1Password credentials, desktop software, or external network access.
- **V3:** `pnpm --filter @repo-toolkit/publish-packages test` for package metadata/docs changes; `pnpm --filter @repo-toolkit/release-artifact test` for artifact integration.
- **V4:** `pnpm build` and an actual installed-consumer test from release-rewritten package manifests in `/tmp/opencode`. Install prepared internal dependencies locally, then load the SDK runtime and invoke a direct command with controlled invalid/no credentials. No npm publish is needed. Do not substitute a tarball `--help` run or an install containing unresolved `workspace:*` for this check.
- **V5:** website edits/install/checks from `website/` as a separate project: `pnpm typecheck`, `pnpm build`. Do not install the website from the repository root.
- **V6:** opt-in synthetic-file workflow against a designated real vault through the SDK, with service-account auth and desktop auth each recorded separately. Never record tokens or file bodies. Connect is not a prerequisite for direct validation; real dual-provider interoperability is an additional check only when Connect is available.

Package tests rebuild shared outputs, so run build/test commands serially. Planning changes do not require implementation suites; distinguish this session's document checks from future V1–V6 results.

## Executable Tasks

### Task SDK-DIRECT-01: Verify The Released SDK Contract And Runtime

Status: complete

Kind: investigation

Priority: P1 — authentication, runtime assets, and cancellation semantics determine the adapter boundary.

Dependencies: none.

Primary ownership: this document's SDK evidence; a disposable SDK install/probe in `/tmp/opencode`; fixtures subsequently owned by SDK-DIRECT-03.

Finding / references: official docs and npm metadata establish the SDK route and wasm dependency, but no released SDK was installed during planning (external references 1–4).

Requirements:

1. Inspect/install candidate `@1password/sdk@0.5.0`; record supported Node/platform requirements, exports, wasm asset resolution, initialization/disposal lifecycle, account selector, and integration name/version requirements.
2. Record exact list/get/create signatures and item/field mappings, pagination/archived filtering, error codes, rate-limit handling, built-in retries, cancellation support, and whether uncertain creates may finish after timeout.
3. Prove an installed Node 20 process can load the SDK/core without contacting a real account. Check type compatibility with the repository's ES2018 configuration, not only build transpilation.
4. Write an adapter capability table distinguishing documented guarantees, inspected code behavior, and live-unverified assumptions. If current support differs, update the proposed pinned version or contract with evidence before adding the dependency.

Acceptance criteria: chosen exact release, signatures/mapping fixtures, runtime load evidence, and a concrete deadline/retry strategy. A promise race alone cannot be described as cancellation. Live account behavior remains assigned to SDK-DIRECT-08.

Verification: disposable runtime/type probe and source/documentation review; record actual commands/results. No authenticated request is needed to complete this bounded investigation.

Completion evidence (2026-09-20; changed paths: this task file only; no repo `src/`/`test`/config touched; no dependency added):

- Baseline: `git status --short` showed pre-existing `M docs/tasks/20260920-100015-secret-sync-package.md` and untracked `?? docs/tasks/20260920-152444-secret-sync-direct-onepassword.md`; both preserved, no commit, no CHANGELOG change.
- Package metadata (`npm view`, network available): `@1password/sdk@0.5.0` (dist-tags `latest`/`stable` = `0.5.0`), MIT, unpacked 125.7 kB, single exact dep `@1password/sdk-core: 0.5.0`; `@1password/sdk-core@0.5.0`, MIT, unpacked 14.0 MB (`nodejs/core_bg.wasm` 14.0 MB + `nodejs/core.js` 23.9 kB). Neither package declares `engines`/`os`/`cpu`; SDK targets Node.js only per README description. SDK devDeps pin `@types/node ^20.11.0`.
- Exports: SDK `main`/`types` = `./dist/sdk.js`/`./dist/sdk.d.ts`; `exports` map exposes only `.` — deep `require("@1password/sdk/dist/...")` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` (proven on Node 20.10.0). Public surface: `createClient`, `DesktopAuth`, `Client`, `Secrets`, error classes, enums (`ItemCategory`, `ItemFieldType`, `ItemState`, `VaultType`, permission flags), `DEFAULT_INTEGRATION_NAME/VERSION` (`"Unknown"`/`"Unknown"`), `ReviverFunc`/`ReplacerFunc`, `throwError`.
- Wasm resolution (`sdk-core/nodejs/core.js:812-816`): `path.join(__dirname, 'core_bg.wasm')` + `readFileSync` + `new WebAssembly.Module/Instance` synchronously at require time. Consequence for SDK-DIRECT-03/07: SDK must stay external to tsup (never bundled/inlined); file-based consumer must ship `node_modules/@1password/sdk-core/nodejs/core_bg.wasm` next to `core.js`. `__dirname`-relative load breaks if the wasm is relocated without its sibling JS.
- Lifecycle: `createClient(config)` -> `createClientWithCore(config, new SharedCore())` (`dist/client_builder.js:24-43`); `SharedCore` defaults to `WasmCore`, `setInner(new SharedLibCore(accountName))` only for desktop auth. Local pre-validation throws before any network: `createClient` without `auth`/`oidcFetcher` rejects with `createClient requires either 'auth' (service account token) or 'oidcFetcher' (workload identity).` Disposal is `FinalizationRegistry` -> `core.releaseClient(id)`; no explicit `close`/`dispose` on `Client`. `DesktopSessionExpiredError` triggers one automatic re-`initClient` + single re-`invoke` (`dist/core.js:118-133`) — the only built-in retry.
- Auth/config: `DesktopAuth(accountName)` accepts account name (sidebar display name) or account UUID per README + `dist/configuration.d.ts`; passed as `account_name` in desktop IPC. `clientAuthConfig` maps string `auth` -> `serviceAccountToken`, `DesktopAuth` -> `accountName`; `integrationName`/`integrationVersion` are required (no SDK-side defaulting despite exported `DEFAULT_*`). Desktop IPC lib search paths are darwin/linux/win32 only (`dist/shared_lib_core.js:53-91`); other platforms throw `Unsupported platform`. OIDC (`oidcFetcher` + `workloadDetails`) exists but is out of scope (non-goal).
- Signatures (inspected `dist/*.d.ts`): `items.create(params: ItemCreateParams): Promise<Item>` (vault inside params); `items.get(vaultId, itemId)`; `items.getAll(vaultId, itemIds)`; `items.put(item)`; `items.delete/archive(vaultId, itemId)`; batch `createAll/deleteAll`; `items.list(vaultId, ...filters: ItemListFilter[])` returns full `ItemOverview[]` — no pagination parameters; sole filter is `{ type: "ByState", content: { active, archived } }`, default active-only (docs confirm). `ItemOverview` = `{ id, title, category: ItemCategory, vaultId, websites, tags, createdAt/updatedAt: Date, state: ItemState }`. `Item` adds `fields: ItemField[]` (`{ id, title, sectionId?, fieldType: ItemFieldType, value, details? }`), `sections`, `notes`, `version`, `files`, `document?`. 25 `ItemCategory` values incl. `SecureNote` + `Unsupported`; 15 `ItemFieldType` values incl. `Concealed`/`Text` + `Unsupported`. File APIs (`items.files.attach/read/delete/replaceDocument`, `Uint8Array` content) exist; 50 MB FFI `messageLimit` enforced in `SharedCore.invoke` (`dist/core.js:19,83-92`).
- Errors/quotas/retries/cancellation (inspected, zero live calls): typed errors are exactly `DesktopSessionExpiredError`, `RateLimitExceededError`, `AuthExpiredError`; all other core failures surface as generic `Error(message)` via `throwError`. `rg` over `dist/*.js` finds no `AbortSignal`/`signal`/`timeout`/`retries`/pagination tokens: no cancellation, no timeout, no backoff, no paging exposed. Rate limiting = error mapping only, no documented quota numbers found in README/docs page. Uncertain-create: structurally implied (caller-side timeout race cannot abort the in-flight `invoke`), live-unverified — adapter must treat post-timeout creates as uncertain and reconcile via logical IDs.
- Node 20 load proof (no network, no credentials): disposable install in `/tmp/opencode/sdk-probe` (`npm install @1password/sdk@0.5.0`), probe `/tmp/opencode/sdk-probe/probe.cjs` run with `~/.asdf/installs/nodejs/20.10.0/bin/node` (repo has no Node 20 shim; 20.10.0 installed via asdf). `require("@1password/sdk-core")` instantiates wasm; `require("@1password/sdk")` exposes all expected exports; `clientAuthConfig` maps SA/desktop configs; `SharedCore` exposes init/invoke/release; `Items.prototype` = create/createAll/get/getAll/put/delete/deleteAll/archive/list; error-mapping verified (`RateLimitExceeded` -> class, unknown -> `Error`); `createClient` without auth rejects locally. No packet left the host beyond the npm registry fetch. Repo workspace untouched by the install.
- ES2018 type-compat: `/tmp/opencode/sdk-probe/type-probe.ts` (createClient SA/desktop, list with ByState filter, get, SecureNote create with Concealed field, ItemState check) typechecks clean under `target ES2018 + strict + skipLibCheck:false` with repo toolchain tsc 6.0.3 (`tsc -p tsconfig.probe.json`, exit 0, no errors — stricter than the repo's `skipLibCheck:true`). Runtime note: SDK ships TS `#private` typings and Node-20-era runtime helpers (`FinalizationRegistry`, `WeakMap`, `TextEncoder`) — compatible with `engines node>=20`, but the SDK must remain an external runtime dep, never inlined into ES2018-targeted repo sources.
- Pinned version recommendation: `@1password/sdk@0.5.0` with exact `@1password/sdk-core@0.5.0` (only published pair; dist-tags `latest`/`stable`/`beta` all resolve to 0.5.0; SDK `SDK_BUILD_NUMBER` `0050002`, core `0.5.0`). Pin exact in SDK-DIRECT-03; do NOT float on `^`.
- Capability table summary (documented vs inspected vs live-unverified): service-account + desktop auth, item list/get/create/update/delete/archive, vault/group/secrets/files APIs, ByState archived filtering, SecureNote+Concealed mapping, 3 typed errors, 50 MB FFI bound, wasm-via-`__dirname`, lazy single client + registry disposal = inspected-verified. Service-account Personal-vault exclusion, desktop approval breadth, quota numbers, cross-backend record interop, multi-platform loads, actual network error shapes, uncertain-create-after-timeout = live-unverified (assigned to SDK-DIRECT-08; nothing above marked verified beyond inspection/probe).
- Follow-ups for SDK-DIRECT-03: injectable core/client factory (deep imports blocked by `exports` — use `createClientWithCore` via public entry or wrap `createClient`); supply real `integrationName`/`integrationVersion` (e.g. `repo-toolkit-secret-sync`/package version); implement outer deadline + no-retry-on-create + `uncertain-write` classification since SDK has no cancellation/timeout/retries; map only the 3 typed errors + generic `Error` to `SecretSyncError` with token redaction; request both ByState filter states for complete listings; convert `ItemCategory`/`ItemFieldType` enums at the boundary and never persist SDK-native values.

### Task SDK-DIRECT-02: Define Provider-Neutral Config And Store Contracts

Status: complete

Kind: improvement

Priority: P1 — one validated provider choice must govern every caller.

Dependencies: none.

Primary ownership: `packages/secret-sync/src/{types,config,store,index}.ts`, shared concurrency helper extraction from `connect.ts`, affected `records.ts`/`history-store.ts`/`operations.ts` imports, focused config/contract tests.

Finding / references: `types.ts:17-22`, `config.ts:161-179`, and `store.ts:5-47` currently constrain the remote and DTO names to Connect; shared concurrency helpers live in the Connect module.

Requirements: add the selected config union with strict per-variant/auth validation; normalize provider-neutral item DTOs while preserving existing exported Connect type/function contracts where structurally compatible; move truly shared concurrency helpers to a neutral module without changing behavior. Keep credential resolution and client creation out of plan validation. Existing Connect defaults and schema-v1 record bytes remain compatible.

Acceptance criteria: both sample remotes validate; unknown/mixed fields and raw-token properties fail; desktop/service-account defaults are deterministic; missing Connect environment variables do not affect SDK config planning; existing Connect config/record tests pass. Public declaration tests exercise both remote variants.

Verification: V1, V2.

Completion evidence (2026-09-20; changed paths: `packages/secret-sync/src/types.ts`, `src/config.ts`, `src/store.ts`, `src/concurrency.ts` (new), `src/connect.ts`, `src/records.ts`, `src/history-store.ts`, `src/operations.ts`, `src/index.ts`, `src/cli-options.ts`, `src/init.ts`, `src/cli.ts`, `test/index.test.ts`; no package metadata/lockfile/config change; no commit; no CHANGELOG change):

- Baseline: `git status --short` showed pre-existing `M docs/tasks/20260920-100015-secret-sync-package.md` and untracked `?? docs/tasks/20260920-152444-secret-sync-direct-onepassword.md`; preserved, no commit.
- Config union: `SecretSyncRemoteConfig` is now `SecretSyncConnectRemoteConfig | SecretSyncSdkRemoteConfig` with `schemaVersion: 1` unchanged; omitted `remote.type` still defaults to `onepassword-connect` with `OP_CONNECT_HOST`/`OP_CONNECT_TOKEN` defaults; SDK variant requires explicit `auth.type` (`service-account` defaults `tokenEnv` to `OP_SERVICE_ACCOUNT_TOKEN`; `desktop` requires non-empty `account`); per-variant allowlists reject Connect fields in SDK configs, SDK `auth` in Connect configs, raw `token`/`authToken`/`serviceAccountToken`/`tokenValue` properties, and incompatible auth fields (`account` in service-account, `tokenEnv` in desktop).
- Store neutrality: `SecretItemField/Summary/Detail`, `CreateSecretItemInput`, and `SecretStore` are canonical in `store.ts`; `ConnectItem*`/`CreateConnectItemInput` remain as type aliases and `validateConnect*` wrappers delegate to neutral validators, preserving existing Connect imports; `records.ts`/`history-store.ts` now use neutral DTO names with identical runtime bytes; schema-v1 record construction/decoding untouched.
- Concurrency: `validateConcurrency` + `mapWithConcurrency` moved verbatim to `src/concurrency.ts` (`SHARED_DEFAULT/MAX_CONCURRENCY` = 4/8); `connect.ts` re-exports both for backwards compat; `history-store.ts`/`operations.ts` import from `./concurrency`; `index.ts` exports concurrency helpers from `./concurrency` and Connect constants from `./connect`.
- Planning isolation: `resolveSecretSyncPlan`/`validateSecretSyncConfig` never touch env or clients; `createSecretStoreForPlan` returns injected stores verbatim and only constructs Connect otherwise (SDK without injection throws); `resolveEndpointForPlan` throws SDK-specific error instead of demanding Connect host; `initSecrets` skips Connect endpoint binding for SDK configs; `collectCliSecrets` redacts SDK service-account tokens and `cli.ts` fallback includes `OP_SERVICE_ACCOUNT_TOKEN`.
- Tests: new `provider-neutral remote contracts` suite in `test/index.test.ts` covers both documented SDK remotes, omitted-type Connect default, deterministic defaults, unknown/mixed/raw-token/incompatible-auth rejections, SDK planning plus injected-store creation with `OP_CONNECT_HOST`/`OP_CONNECT_TOKEN` unset, neutral/Connect validator equivalence, and neutral-vs-Connect `mapWithConcurrency` parity; all pre-existing Connect config/record suites unchanged and passing.
- Verification: `pnpm lint` clean; `pnpm typecheck` clean (src-only includes); `pnpm --filter @repo-toolkit/secret-sync test` 21 files / 257 tests passed.

### Task SDK-DIRECT-03: Implement The Lazy Direct SDK Store

Status: complete

Kind: improvement

Priority: P1 — implement real direct item access with bounded failure behavior.

Dependencies: SDK-DIRECT-01, SDK-DIRECT-02.

Primary ownership: `packages/secret-sync/src/sdk.ts` and SDK client boundary, `src/errors.ts`, package `package.json`/`tsup.config.ts`, root `pnpm-lock.yaml`, `test/sdk.test.ts` and fake SDK fixtures.

Finding / references: `SecretStore` has the required list/get/create contract, but `createSecretStoreForPlan` only creates Connect. SDK/core are not current runtime dependencies.

Requirements: add the validated pinned dependency; implement one lazy client per command with injectable factory, service-account and desktop auth, exact vault scoping, enum/field conversion, correct item list completion/filtering, structural/record bounds, and client cleanup if supported. Map errors to stable safe toolkit errors. Implement evidence-backed deadlines/retries without overlapping retry storms or replaying uncertain creates; classify late/ambiguous writes for existing logical-ID reconciliation.

Acceptance criteria: fake SDK tests cover list/get/create for both auth modes, empty/binary/max-size envelopes, unsupported unrelated items, missing vault, denied/cancelled desktop access, expired/invalid tokens, quotas, incomplete listings, duplicate titles, oversized records, and delayed create completion. Concurrent calls share one initialization. Tokens and synthetic payload canaries are absent from error serialization/causes and CLI-facing diagnostics. Runtime loader fails clearly on missing assets rather than falling back to Connect.

Verification: V1, V2, V3 metadata tests; SDK runtime loading according to SDK-DIRECT-01 evidence.

Completion evidence (2026-09-20; changed paths: `packages/secret-sync/src/sdk.ts` (new), `src/index.ts` (SDK export block), `package.json`/`pnpm-lock.yaml` (exact `@1password/sdk: 0.5.0`), `tsup.config.ts` (external SDK/core), `test/sdk.test.ts` (new); no commit; no CHANGELOG change; SDK-DIRECT-02 working-tree changes preserved untouched):

- Baseline: `git status --short` showed SDK-DIRECT-02's staged-in-working-tree modifications plus the untracked phase task file; all preserved, no commit.
- Dependency: `@1password/sdk: 0.5.0` exact in `packages/secret-sync/package.json` via `pnpm --filter @repo-toolkit/secret-sync add @1password/sdk@0.5.0 --save-exact`; lockfile records `specifier: 0.5.0 / version: 0.5.0` with transitive `@1password/sdk-core: 0.5.0` exact, so no explicit sdk-core pin was needed. `tsup.config.ts` marks both external; built `dist/` contains zero `core_bg.wasm` references and keeps a bare `@1password/sdk` import.
- Store: `SdkSecretStore`/`createSdkStore` implement `SecretStore` with an injectable `SdkClientFactory` (fakes in tests, lazy `defaultSdkClientFactory` in production that dynamic-imports `@1password/sdk` only on first operation and never touches Connect). One memoized client per store shared by concurrent calls; service-account token read from `tokenEnv` at execution; desktop uses the explicit account selector; every call passes the exact configured vaultId. List requests a single `ByState { active: true, archived: true }` filter and emulates title filtering client-side; non-SecureNote categories and foreign vaultIds are skipped while malformed entries fail loudly. `SecureNote`/`Concealed`/`Text` conversion happens at the boundary in both directions; returned DTOs contain only neutral `SECURE_NOTE`/`CONCEALED`/`STRING` values. Structural bounds reuse `store.ts` validators; record scans bound at 10000, details at 256 KiB, create field values at 64 KiB. `close()` invokes client cleanup when present and is otherwise a safe no-op, matching the 01 finding of registry-based disposal.
- Errors/deadlines: only `errors.ts` codes are emitted; causes carry `{ name }` without SDK message text, stacks, tokens, or payloads. List/get use a 30 s outer deadline with up to 3 bounded backoff retries (100 ms base, 2 s cap) on retryable reads only; creates are never retried and any timeout/network/server/rate-limited/ambiguous failure returns `{ status: 'uncertain', attempts: 1 }` for logical-ID reconciliation, while auth/not-found/validation/too-large/schema failures throw deterministically. Loader/import failures throw a clear `server` error naming the SDK assets instead of falling back to Connect.
- Tests: `test/sdk.test.ts` (26 tests) uses fake clients only — both auth modes list/get/create, empty/binary/max-32 KiB envelope round-trips decoded via `records.ts`, unsupported/foreign skipping, archived inclusion, exact title filter, duplicate titles, missing vault, denied/cancelled desktop, expired/invalid/missing tokens, quota with exactly 4 attempts/3 sleeps, incomplete listing as `remote-incomplete`, oversized create/detail/record-scan, read deadline with zero retries, delayed-create uncertainty plus `reconcileRecordByLogicalId` recovery, receipt vault-mismatch uncertainty, init-failure surfacing, token/payload canary absence from serialized errors/causes, Connect-free env operation, lazy construction, single shared init under 6-way concurrency, and lifecycle close.
- Verification: V1 `pnpm lint` clean and `pnpm typecheck` clean; V2 `pnpm --filter @repo-toolkit/secret-sync test` 22 files / 283 tests passed; V3 `pnpm --filter @repo-toolkit/publish-packages test` 3 files / 85 tests passed. Node 20.10.0 ESM: `import('@1password/sdk')` loads with expected exports; full `dist/index.js` ESM load verified on the repo toolchain Node (20.10.0 full-dist load is blocked by the pre-existing `@clack/prompts` `styleText` requirement in `publish-package`, unrelated to this change). Missing-asset probe: temporarily relocating `core_bg.wasm` makes the SDK import fail with a clear ENOENT, then restored and re-verified loadable; the factory catch maps any such failure to the explicit runtime-assets error.

### Task SDK-DIRECT-04: Migrate Local State To Typed Remote Identity

Status: complete

Kind: improvement

Priority: P1 — direct configuration cannot reuse a fabricated URL or an unrelated baseline.

Dependencies: SDK-DIRECT-02.

Primary ownership: `packages/secret-sync/src/state.ts`, identity-facing inputs in `push.ts`/`pull.ts`/`restore.ts`/`rollback.ts`/`branches.ts`/`resolve.ts`, identity helpers, state/operation tests.

Finding / references: `state.ts:31-61,126-163` only accepts HTTP endpoint identity; operation callers currently pass endpoint/vault/project fields.

Requirements: implement the selected v2 identity union and legacy Connect normalization; preserve legacy external inputs through one explicit boundary; migrate legacy persisted state only on a successful state write. Preserve journals, keys, branch materialization, and baselines. Direct auth changes/token rotation for the same vault/project are permitted; backend/vault/project changes fail identity checks. Read-only calls and dry runs do not migrate state.

Acceptance criteria: v1 Connect fixtures work and migrate atomically without losing data; SDK state contains no endpoint/token/session; both direct auth modes produce the same vault/project binding; changed provider or vault fails before file/remote writes; interrupted migration and preexisting journals recover; ambiguous old/new input forms are rejected.

Verification: V1, V2, including fault-injection state tests and all affected operation suites.

Completion evidence (2026-09-20; changed paths: `packages/secret-sync/src/state.ts`, `src/push.ts`, `src/pull.ts`, `src/restore.ts`, `src/rollback.ts`, `src/branches.ts`, `src/resolve.ts`, `src/index.ts`, `src/doctor.ts` (one-line type-narrowing only, full diagnostics deferred to 05), `test/state-identity.test.ts` (new); no commit; no CHANGELOG change):

- Baseline: `git status --short` showed pre-existing SDK-DIRECT-02/03 working-tree modifications plus untracked phase task file; all preserved, no commit.
- State v2: `SECRET_SYNC_STATE_SCHEMA_VERSION = 2` with discriminated `StateRemote` (`onepassword-connect { type, endpoint, vaultId }` vs `onepassword-sdk { type, vaultId }`) and `RemoteIdentity` (`Connect { type, endpoint, vaultId, projectId }` vs `SDK { type, vaultId, projectId }`). SDK state holds no endpoint/token/session; persisted SDK JSON verified free of `endpoint`/`token`/`session`/`http`. `validateStateRemote`/`validateRemoteIdentity` enforce per-variant allowlists and reject mixed SDK+endpoint/auth forms; legacy `{ endpoint, vaultId, projectId }` normalizes to Connect through that single boundary.
- Legacy read/migrate: `assertSecretSyncState` accepts schemaVersion 1 (exact endpoint binding) and 2, always returning normalized v2 in memory. `readStateIfPresent`/`loadStateFile`/`loadState` never write; dry-run paths in push/pull/restore/rollback/switch assert identity without saving. `saveState` always writes v2 atomically (existing temp+rename+fsync path), preserving baselines/HMAC/heads/journalSeq/active/materialized branches; journals untouched by migration.
- Matching: `identitiesMatch` requires same provider type + exact vault + project, plus exact endpoint only for Connect; auth material is never compared, so service-account rotation and auth-mode changes for the same vault/project keep baselines. Provider/vault/project change, case-variant or prefix-adjacent vault names (`vault-10`, `Vault-1`), and Connect-vs-SDK with the same vault all yield `identity-mismatch` whose message directs to a fresh worktree/state directory with unbased-conflict reconciliation. Mismatch throws before any remote/file writes (verified via fake-store create counts and unchanged worktree bytes); journals are never auto-deleted and no rebind command was added.
- Operation boundary: push/pull/restore/rollback/switch accept `identity` (full) or `remote` + `projectId` (binding) alongside legacy `endpoint`/`vaultId`/`projectId` through `normalizeOperationIdentity`, which rejects every mixed old/new combination (`endpoint`+`identity`, `remote`+`endpoint`, `remote`+`vaultId`, `identity`+`projectId`, bare `remote` without project). `createBranch`/`resolveFork` accept optional `identity`/`remote` for provider-neutral project resolution with the same ambiguity rejection; `listBranches(store, projectId)` is already provider-neutral. Legacy endpoint callers work unchanged (all 283 pre-existing tests pass unmodified).
- Public changes recorded for 05: `SecretSyncState.schemaVersion` is now `2` with discriminated `remote`; `RemoteIdentity` is now a discriminated union (legacy flat shape still accepted on input via normalization); stateful operation options (`Push/Pull/Restore/Rollback/Switch`) now take optional `endpoint`/`vaultId`/`projectId` plus optional `remote`/`identity`; `BranchCreate/Resolve` options gain optional `remote`/`identity`; new exports `StateRemote/RemoteBinding/ConnectRemoteIdentity/SdkRemoteIdentity/ConnectStateRemote/SdkStateRemote/LegacyRemoteIdentity/OperationIdentityInput/validateStateRemote/normalizeOperationIdentity/remoteIdentityFromConfig` from `src/state.ts` via `src/index.ts`; `doctor.ts` state comparison now narrows to Connect (full provider-aware diagnostics remain 05).
- Tests: new `test/state-identity.test.ts` (17 tests) covers v1 exact-endpoint read, read-only/dry-run non-rewrite (byte-identical file), atomic migrate with preserved localKey/baselines/heads/branches, interrupted migration via `beforeRename` (original bytes kept, journal intact, `recoverJournal` pending) and `afterRename` (migrated bytes loadable with data intact), SDK same-binding via `identity` and `remote`+`projectId`, SDK serialization secrecy, provider/vault/project rejection, vault fuzzy-match rejection, pre-write failure for push/pull/restore/rollback/switch, fresh-worktree/unbased-conflict guidance with journal+worktree preservation, ambiguous-form rejection across push/branch/resolve, and legacy normalization parity.
- Verification: V1 `pnpm lint` clean and `pnpm typecheck` clean; V2 `pnpm --filter @repo-toolkit/secret-sync test` 23 files / 300 tests passed (283 pre-existing + 17 new).

### Task SDK-DIRECT-05: Wire Direct Access Through CLI, Init, And Doctor

Status: complete

Kind: improvement

Priority: P1 — a working SDK adapter must be reachable through every user command.

Dependencies: SDK-DIRECT-03, SDK-DIRECT-04.

Primary ownership: `packages/secret-sync/src/{cli,cli-options,index,init,doctor,format}.ts`, CLI/dispatcher/init/doctor tests and affected exported option/result types.

Finding / references: `cli-options.ts:71-107` and `index.ts:561-579` always resolve a Connect endpoint; `init.ts:129-157` and `doctor.ts:138-168` generate/report Connect-only settings.

Requirements: select the backend once, carry typed identity through the dispatcher, preserve store injection, extend init flags/config generation as specified, and make diagnostics provider/auth aware. Keep help/planning/init local-only. Both library and built CLI must work with all Connect variables unset. Document public type/result adjustments and retain Connect behavior; do not claim SDK transport properties from Connect constants.

Acceptance criteria: built CLI tests exercise the entire command dispatch through a fake SDK, including rollback, branch/switch/resolve, status check exits, strict flags, and both auth modes. SDK mode neither fetches Connect nor launches `op`; Connect never initializes SDK. Existing config is preserved on init; incompatible new flags fail. JSON diagnostics expose provider/mode but no secrets and no fabricated endpoint. Missing auth produces a useful direct-auth error.

Verification: V1, V2, with a regression fixture proving injected SDK stores do not require `OP_CONNECT_HOST`.

Completion evidence (2026-09-20; changed paths: `packages/secret-sync/src/cli-options.ts`, `src/cli.ts`, `src/types.ts`, `src/config.ts`, `src/init.ts`, `src/doctor.ts`, `src/index.ts`, `test/sdk-cli.test.ts` (new); no package metadata/lockfile/config change; no commit; no CHANGELOG change; SDK-DIRECT-02/03/04 working-tree changes preserved untouched):

- Baseline: `git status --short` showed pre-existing SDK-DIRECT-02/03/04 modifications plus the untracked phase task file; all preserved, no commit.
- Backend selection: new `resolveIdentityForPlan(plan, env)` in `cli-options.ts` selects the backend once (SDK identity direct from config; Connect identity via the existing endpoint resolution) and is exported through `src/index.ts`. `runSecretSync` resolves one `RemoteIdentity` and passes `identity`-only inputs to push/pull/restore/rollback/switch/branch-create/resolveFork; log/branch-list receive `identity.projectId`. Legacy endpoint/vault/project operation inputs are untouched, so existing Connect callers keep working. `resolveActiveBranch`/`executeStatus` no longer take an endpoint placeholder. `createSecretStoreForPlan` now builds a real lazy `SdkSecretStore` for SDK plans (vault/auth/env from the plan plus an optional injected `sdkClientFactory`) instead of throwing; the Connect path never touches the SDK factory and the SDK path never touches fetch. Static `sdk.ts` import adds no SDK runtime initialization: the `@1password/sdk` dynamic import and wasm load happen only inside `defaultSdkClientFactory` on first store operation.
- Init: `InitOptions`/`SecretSyncOptions`/`SecretSyncCommandOptions` gain `provider`/`auth`/`account`/`tokenEnv`; CLI `SPECS` plus the `init` allowlist accept `--provider/--auth/--account/--token-env` (all other commands reject them via `assertCommandFlags`, and `validateSecretSyncCommandOptions` rejects them off-init with init-value validation on-init). New configs default to Connect; `--provider onepassword-sdk` requires explicit `--auth`, service-account defaults `tokenEnv` to `OP_SERVICE_ACCOUNT_TOKEN`, desktop requires `--account`; no `--token` value flag exists. Existing configs are byte-preserved on repeat init; provider/vault/auth/account/tokenEnv mismatches and cross-provider flags fail. SDK state binding uses identity-only `initState` with no env reads and no SDK client creation, so planning, help, and local init stay SDK-free. CLI help documents the new init flags.
- Doctor: `DoctorOptions` accepts `identity` (preferred) plus `remote` as an auth-mode hint, with legacy endpoint/vaultId/projectId still accepted; mixing old and new forms fails with the shared identity error. `DoctorResult` gains `provider` (`onepassword-connect` | `onepassword-sdk`) and `authMode` (`token` | `service-account` | `desktop`); `endpointHost` is now optional (present for Connect, absent for SDK, never fabricated) and desktop results carry the non-secret `account` selector. State comparison uses `identitiesMatch`; SDK checks report a `backend` entry instead of `endpoint`, SDK transport bounds (`SDK_MAX_DETAIL_BYTES`, `SDK_MAX_RECORDS`, `SDK_TIMEOUT_MS`, `SDK_MAX_GET_RETRIES`, no create retries) instead of Connect HTTP retry constants, and never claim write probing from a list. Both `DoctorProvider`/`DoctorAuthMode` are exported.
- Public type/result adjustments: `SecretSyncCommandOptions` and `SecretSyncOptions` gain optional `provider`/`auth`/`account`/`tokenEnv`; `SecretSyncOptions` and `StoreOverrides` gain optional `sdkClientFactory`; new export `resolveIdentityForPlan`; `DoctorOptions.projectId/endpoint/vaultId` are now optional with new optional `remote`/`identity`; `DoctorResult` gains required `provider`/`authMode`, optional `endpointHost` (previously required string), and optional `account`. Connect behavior retained: omitted provider still defaults to Connect, Connect endpoint resolution errors unchanged, Connect doctor output keeps `endpointHost` and the existing bounds wording.
- Tests: new `test/sdk-cli.test.ts` (21 tests). Library dispatch through a real `SdkSecretStore` with an in-memory fake SDK client covers push/status-check/diff/log/restore/rollback/branch-create/branch-list/switch/three-head resolve/dry-run (zero creates) for both auth modes with no Connect variables; doctor asserts provider/authMode, absent endpointHost, SDK bounds wording without Connect retry constants, and no token canary or URL in serialization; missing service-account token fails naming `OP_SERVICE_ACCOUNT_TOKEN`. Selection tests prove SDK plans never call fetch and Connect plans never call the SDK factory. Init tests cover generation, custom token env, Connect defaults, byte-preservation, and every incompatible-flag combination. Built `dist/cli.js` spawn tests (Connect vars stripped) cover help, strict unknown/misplaced flags, SDK init generation plus preservation/mismatch, direct-auth error text with no Connect demand, desktop doctor JSON provider/mode/account with no endpoint or secret, and `checkFailed` values that drive the CLI exit code. Full remote dispatch through the spawned binary uses the same `runSecretSync` dispatcher with an injected fake SDK store/factory, since a process boundary cannot inject a store; spawn coverage proves the built CLI surface and SDK-mode error paths end to end.
- Verification: V1 `pnpm lint` clean and `pnpm typecheck` clean; V2 `pnpm --filter @repo-toolkit/secret-sync test` 24 files / 321 tests passed (300 pre-existing + 21 new). V3/V4+ remain with SDK-DIRECT-06/07/08; no package metadata or docs-membership change in this task.

### Task SDK-DIRECT-06: Prove Shared Workflow And Record Interoperability

Status: complete

Kind: improvement

Priority: P2 — preserve file/history guarantees across the new provider boundary.

Dependencies: SDK-DIRECT-05.

Primary ownership: `packages/secret-sync/test/` shared store-contract and two-worktree fixtures, fake SDK/Connect record translation fixtures, minimal corresponding implementation fixes.

Finding / references: `MemoryFakeStore`, existing history graph, and SECSYNC-10 two-worktree evidence provide reusable scenarios, but bypassing the adapter alone cannot test SDK field mapping or auth failures.

Requirements: run shared scenarios through the actual SDK adapter with a fake SDK client and through Connect fixtures: empty/binary/CRLF files, no-op/partial push, fresh pull, explicit deletions, per-file rollback, branches, fork resolution, interrupted publication, and recovered local writes. Exchange serialized records between the two adapters in both directions. Preserve all historical IDs/tree entries; do not use SDK-native revisions as tool revision IDs.

Acceptance criteria: both adapters produce equivalent decoded envelopes and history; rollback affects exactly one file; concurrent/delayed writes preserve both heads; incomplete lists/errors never imply deletion; lost create response reconciles without a new logical revision. Assert bounded concurrency/client initialization and record request counts to expose service-account quota costs. Dry runs invoke zero create/local-state-write operations.

Verification: V1, V2. Real dual-provider access is separately recorded under SDK-DIRECT-08; fake parity is not described as live compatibility.

Completion evidence (2026-09-20; changed paths: `packages/secret-sync/test/sdk-workflow.test.ts` (new); no `src/` change; no package metadata/lockfile/config change; no commit; no CHANGELOG change; SDK-DIRECT-02/03/04/05 working-tree changes preserved untouched):

- Baseline: `git status --short` showed pre-existing SDK-DIRECT-02/03/04/05 modifications plus the untracked phase task file; all preserved, no commit.
- Fixtures: new `test/sdk-workflow.test.ts` (30 tests) runs every shared scenario through the real `SdkSecretStore` with an in-memory fake SDK client (both `service-account` and `desktop` auth) and through the real `ConnectSecretStore` with an in-memory fake `fetch` backend: two-worktree empty/binary/CRLF round-trips with exact bytes, one-file and no-op push request counts (3 creates first push, 0 creates plus bounded lists on no-op), partial push preserving `other.env` baselines, fresh pull, explicit push/pull deletions behind `--delete`, per-file rollback replacing exactly one path with the other blob untouched, metadata-only branch create plus guarded switch, two-parent fork preserving both heads followed by `resolveFork` join, uncertain-write reconcile to one logical record with the fixed commit id, pull journal resume, `local-changed` push recovery, and dry-run push with zero creates and no state file.
- Interop: `exportDetails`/`importDetails` exchange neutral `SecretItemDetail` records SDK->Connect and Connect->SDK; `historySignature` comparison proves identical commit/blob logical IDs, trees, digests, and parents in both directions, with fresh-clone pulls materializing exact bytes (including empty and CRLF) on the receiving adapter. A third test round-trips SDK->Connect->SDK and proves commit/blob key sets are preserved while provider ids (`sdk-item-N`/`provider-c-N`) always differ from tool logical IDs and are never used as revision ids.
- Quota/concurrency: parallel `listItems` x4 shares one SDK client init (delta <= 1); per-push create/list/get deltas asserted; quota/incomplete list failures map to `rate-limited` (never an empty project) with history intact afterwards; dry runs assert `creates` delta 0 and `readStateIfPresent` undefined.
- No implementation fix was needed: all scenarios passed against the SDK-DIRECT-03/04/05 code unchanged, including SDK `identity`-form and Connect legacy endpoint-form operation inputs.
- Verification: V1 `pnpm lint` clean and `pnpm typecheck` clean; V2 `pnpm --filter @repo-toolkit/secret-sync test` 25 files / 351 tests passed (321 pre-existing + 30 new). Live dual-provider compatibility remains assigned to SDK-DIRECT-08; nothing above claims live cross-backend behavior.

### Task SDK-DIRECT-07: Verify Distribution And Document Direct Setup

Status: complete

Kind: improvement

Priority: P2 — users need an installable wasm-backed CLI and accurate setup guidance.

Dependencies: SDK-DIRECT-06.

Primary ownership: package README/examples/metadata, root README/AGENTS.md provider descriptions, `website/docs/packages/secret-sync.md`, consumer/artifact fixtures in secret-sync/release-artifact tests; build configuration only where evidence requires it.

Finding / references: SDK core ships wasm assets; `tsup.config.ts` alone does not prove they survive installation. Parent SECSYNC-10 records an unresolved installed-consumer test on placeholder workspace dependency metadata.

Requirements: test release-prepared npm installation, dependency/wasm loading from an external cwd, and the supported release-artifact/asdf dependency layout without relying on the development workspace. Exercise direct SDK initialization sufficiently to load its core, even when credentials are intentionally invalid. Explicitly handle artifacts configured to omit dependencies. Document both auth setups, same-vault fresh-worktree transition, read/write permissions, Personal-vault service-account restriction, desktop access breadth, retained file limits, quotas, and live-unverified platform limits. Add a fake-SDK example with no vault requirement.

Acceptance criteria: actual installed-consumer/runtime and artifact checks pass; package exports/types work on supported Node/platform targets; help and Connect remain usable without SDK initialization; no unresolved `workspace:*` remains in the consumer fixture. Docs/examples match implemented flags and config. Runtime asset failures are not disguised as credential failures. New dependency license/runtime requirements are represented in distribution as required by existing packaging conventions.

Verification: V1, V2, V3, V4, V5. Record concrete installation/layout results and supported platform evidence.

Completion evidence (2026-09-20; changed paths listed above; no commit; no CHANGELOG change):

- Baseline: `git status --short` showed SDK-DIRECT-02/03/04/05/06 working-tree modifications plus the untracked phase task file; all preserved, no commit. Pre-existing breakage found and fixed: an earlier `mergeClosureDependencies` exact-range test insertion had deleted the `it('rejects incompatible range conflicts ...')` opener, leaving orphaned assertions; the opener was restored and the new exact-range test kept.
- Docs: `packages/secret-sync/README.md` and `website/docs/packages/secret-sync.md` gained Direct SDK setup (service-account + desktop config JSON and `init --provider/--auth/--account/--token-env` commands matching implemented flags), fresh-worktree transition (config-only provider change refuses state reuse; same vault/project IDs; unbased-conflict reconciliation; no auto-delete/rebind), permissions (read-only vs write, Personal/Private/Employee service-account exclusion, desktop breadth beyond the vault filter, exact-vault access checks), retained limits plus SDK bounds (10k records, 256 KiB details, 30 s timeout, 3 bounded read retries, no create retries, uncertain-write reconciliation, rate-limit-as-error with no documented quota numbers), and runtime/platform support (exact pinned versions, wasm size, Node >= 20, darwin/linux/win32 desktop IPC, live-unverified combinations). Root `README.md` and `AGENTS.md` provider descriptions now name the direct-SDK backend, the lazy external SDK runtime, and the fake-sdk example. `examples/fake-sdk.mjs` runs service-account and desktop round trips through the real `SdkSecretStore` against an in-memory fake client with exact-byte verification and no vault/credentials/network (covered by `test/examples.test.ts`).
- Dep license/runtime: `@1password/sdk@0.5.0` (MIT) exact with transitive `@1password/sdk-core@0.5.0` (MIT, `nodejs/core_bg.wasm` ~14 MB unpacked) recorded in `AGENTS.md` and both setup docs; SDK stays external to tsup (`external: ['@1password/sdk', '@1password/sdk-core']`, zero `core_bg.wasm` references in `dist/`) and ships via the production dependency closure; release-rewritten manifests fill `license: Apache-2.0` (plus author/bugs/repository/engines) from the root manifest.
- V1: `pnpm lint` clean, `pnpm typecheck` clean (ES2018 strict; new tests use `createRequire` and `spawnSync` only).
- V2: `pnpm --filter @repo-toolkit/secret-sync test` 26 files / 364 tests passed. New `distribution.test.ts` cases: release-prepared rewrite simulation (placeholder/license fill, every `workspace:` range resolved, SDK pin stays `0.5.0`, engines/files retained); external-cwd real-SDK load where `createClient` with a malformed token fails locally with a token-format error containing `token` and no `asset`/`wasm` wording (no network, no credentials); shipped `dist/index.d.ts` exposes `SdkSecretStore`/`createSdkStore`/`defaultSdkClientFactory` behind the canonical exports map; built `--help` documents `--auth service-account | desktop` and `--token-env <name>` with Connect variables stripped.
- V3: `pnpm --filter @repo-toolkit/publish-packages test` 3 files / 85 tests passed; `pnpm --filter @repo-toolkit/release-artifact test` 1 file / 101 tests passed (includes the kept exact-external-range closure test proving the `0.5.0` pin survives production-closure merging).
- V4 (fresh, `/tmp/opencode/sdk07-v4`, current sources): `pnpm build` clean; staged release-rewritten `secret-sync`/`publish-package` manifests carry version `7.7.7-sdk07`, `license` `Apache-2.0`, zero `workspace:*` refs (`rg workspace:` exit 1 on staged manifests, lockfile, and consumer manifest), and SDK `0.5.0` exact; `pnpm install` in the external consumer reused 11 packages from the store with 0 downloads. Installed-consumer probes on Node 22.11.0 and 26.7.0: library exposes `runSecretSync`/`resolveSecretSyncPlan`/`SdkSecretStore`/`defaultSdkClientFactory` with `SDK_TIMEOUT_MS` 30000; installed `repo-toolkit-secret-sync --help` exits 0; Connect `doctor` against a loopback fake server passes `read` without SDK initialization; SDK `doctor` with `OP_SERVICE_ACCOUNT_TOKEN=invalid-token-for-probe-only` reports `provider: onepassword-sdk`, `authMode: service-account`, no `endpointHost`, `read: fail` with the auth message; SDK `status` with the invalid token throws `code: auth` with no `assets` wording; missing token throws `auth` naming `OP_SERVICE_ACCOUNT_TOKEN`. Direct SDK/core import through the installed closure (`createClient`/`DesktopAuth` functions, wasm `__wasm` exports) loads on Node 20.10.0 and 22.11.0 from the external cwd. SDK-absent simulation (staged bundle with `publish-package`+`picomatch` linked but no `@1password/*`) throws `code: server`, `1Password SDK runtime failed to load; verify @1password/sdk and @1password/sdk-core assets are installed.` — the `none`-mode failure shape, never a credential error. Full-workspace `buildReleaseArtifact` production mode: tarball built with 16 commands, production install resolved `@1password/sdk 0.5.0`, extracted tree contains `node_modules/.pnpm/@1password+sdk-core@0.5.0/.../core_bg.wasm` (56 tarball members mention `1password`), and `bin/repo-toolkit-secret-sync --help` exits 0 with an explicit node binary from the external cwd. `none` mode tarball contains zero `node_modules` members with bins plus manifest intact.
- V4 limits recorded honestly: the full-library probe cannot run on Node 20.10.0 because the pre-existing `@clack/prompts` `node:util styleText` requirement (unrelated to this change, already noted in SDK-DIRECT-03) rejects at import; SDK core alone loads on 20.10.0. `verifyReleaseArtifact`'s spawned `--help` exits 126 in this environment because the asdf `node` shim cannot resolve a version outside the repo checkout; the same wrapper was verified manually (`--help` exit 0) with `REPO_TOOLKIT_NODE_BIN` and from the repo cwd.
- V5: website `pnpm typecheck` clean and `pnpm build` succeeded (`Generated static files in "build".`) from `website/` as a separate project.
- Live dual-provider interoperability and live quota/permission/platform behavior remain assigned to SDK-DIRECT-08; nothing above claims live cross-backend compatibility.

Completion evidence (2026-09-20; changed paths: `packages/secret-sync/test/distribution.test.ts` (extended), `test/examples.test.ts` + `examples/fake-sdk.mjs` (pre-existing, kept), `packages/release-artifact/test/index.test.ts` (syntax repair + exact-external-range test kept), `packages/secret-sync/README.md`, `website/docs/packages/secret-sync.md`, `README.md`, `AGENTS.md`; no `src/` change; no package metadata/lockfile change beyond SDK-DIRECT-03; no commit; no CHANGELOG change; SDK-DIRECT-02/03/04/05/06 working-tree changes preserved untouched):

### Task SDK-DIRECT-08: Verify Real Direct Workflows And Close The Phase

Status: blocked

Kind: improvement

Priority: P2 — establish direct-provider support with real evidence rather than only mock behavior.

Dependencies: SDK-DIRECT-07.

Primary ownership: this document's completion evidence, opt-in integration fixtures, final acceptance review.

Finding / references: no live SDK auth/storage validation was performed during planning; the parent Connect live-verification gap does not establish either SDK failure or SDK compatibility.

Requirements: using synthetic files in a designated vault, verify service-account read-only/read-write behavior and a direct two-worktree push/pull/log/rollback/branch workflow with Connect unavailable. Separately exercise desktop approval, denial/locking/session expiry as supported, explicit account selection, and the same file workflow. Record SDK/Node/OS versions, exact encoded bounds, request/quota observations, and cleanup. If Connect is available, prove cross-backend read/write compatibility after synchronization; otherwise record that claim as blocked separately from direct-only success. Review every task criterion and public docs/types.

Acceptance criteria: V6 evidence for each advertised direct auth mode; V1–V5 required checks pass; direct workflows never require Connect; exact bytes, IDs, history, and rollback semantics agree with the shared protocol. Missing credentials or a desktop installation blocks the corresponding verification, with named prerequisites; do not mark the full phase complete based on mocks. Do not claim additional platforms or live cross-backend compatibility without evidence.

Verification: V1–V6 as applicable, serialized; append actual results and unresolved release limitations.

Blocked evidence (2026-09-20; changed paths: this task file only; no `src/`/`test`/config/metadata change; no commit; no CHANGELOG change):

- Prerequisite check (presence only, no values recorded): `OP_SERVICE_ACCOUNT_TOKEN`, `OP_CONNECT_HOST`, and `OP_CONNECT_TOKEN` are all absent from the environment; no 1Password desktop config directory and no `op`/desktop binary in `PATH`; host is Linux on WSL2 with no desktop installation. No live request was attempted and no live success is claimed.
- Blocked (a) service-account read-only/read-write plus direct two-worktree push/pull/log/rollback/branch workflow with Connect unavailable: requires a designated vault and a scoped service-account token; neither is present.
- Blocked (b) desktop approval, denial/locking/session expiry, explicit account selection, and the same file workflow: requires a supported desktop installation and account; neither is present.
- Blocked (c) cross-backend read/write compatibility after synchronization: requires Connect availability in addition to (a); Connect host/token are absent, so this claim is recorded as blocked separately from direct-only verification per the requirements.
- V1 fresh rerun on the current tree: `pnpm lint` clean; `pnpm typecheck` clean (ES2018 strict).
- V2 fresh rerun: `pnpm --filter @repo-toolkit/secret-sync test` 26 files / 364 tests passed.
- V3 fresh rerun: `pnpm --filter @repo-toolkit/publish-packages test` 3 files / 85 tests passed; `pnpm --filter @repo-toolkit/release-artifact test` 1 file / 101 tests passed.
- V4 fresh rerun: `pnpm build` clean across all packages. Installed-consumer/runtime and artifact-layout sanity were already proven in SDK-DIRECT-07 on these sources and are not re-run here: no `src/` or metadata change since 07.
- V5 not re-run: no `website/` change in this task; website content is identical to the SDK-DIRECT-07 verification, which passed `pnpm typecheck` and `pnpm build` from `website/`.
- Docs/types review: root `README.md` and `AGENTS.md` name the direct-SDK backend; package `README.md` and `website/docs/packages/secret-sync.md` document both auth setups with the implemented `--provider`/`--auth`/`--account`/`--token-env` flags, fresh-worktree transition, permissions and Personal-vault service-account restriction, retained plus SDK bounds, and runtime/platform limits; `src/types.ts`, `src/config.ts`, `src/init.ts`, and `src/cli.ts` flag and key names agree with the docs. No drift found; no fix required.
- Release limitations carried forward: live service-account behavior (quotas, permission breadth, uncertain-create-after-timeout shapes), live desktop approval breadth and session behavior, live cross-backend record interop, and live platform coverage beyond the 07 installed-consumer matrix remain unverified. The phase is implementation-complete; final sign-off awaits the three blocked live checks above.

## Execution Readiness And Definition Of Done

SDK-DIRECT-01 and SDK-DIRECT-02 can begin without a Connect deployment or live credentials. SDK-DIRECT-08 needs a designated 1Password vault, suitably scoped service-account credentials, and a supported desktop installation/account for the desktop portion. No further product decision is required from the user to start this plan.

Deferred: in-place backend rebinding, Document/attachment storage and larger file limits, workload identity, cloud HTTP protocol reimplementation, and new retention/migration mechanisms. The current storage bounds keep the two backends on one record format; SDK file-upload support can be addressed in a later storage-format task.

Done means the existing package offers a supported direct SDK mode for both explicit auth choices; every current sync/history/branch command works without Connect; state and record compatibility are verified; published consumers receive the SDK runtime; setup docs are accurate; and live evidence or explicitly blocked compatibility claims are recorded. An incomplete required live check keeps final integration blocked even when implementation is delivered.
