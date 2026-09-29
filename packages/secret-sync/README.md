# `@repo-toolkit/secret-sync`

Synchronize explicitly selected local files with 1Password Connect or
directly with the official 1Password SDK, preserving exact bytes including
binary data and line endings.

The long-form guide lives at
<https://repo-toolkit.pages.dev/docs/packages/secret-sync>.

## Installation

```sh
pnpm add -D @repo-toolkit/secret-sync
```

## Configuration

`secret-sync.config.json` (JSON, `.mjs`, or `.cjs` via the shared
`loadConfigFile` helper). Commands use `./secret-sync.config.json` from
the working directory by default; pass `--config <path>` to use another file.
`init` can create it, `vault list --provider …` can discover vaults without it,
and all help runs without loading config or credentials:

```json
{
  "schemaVersion": 1,
  "projectId": "a64208df-4a95-4516-b8c7-e00621a7820c",
  "root": ".",
  "remote": {
    "type": "onepassword-connect",
    "vaultId": "<1password-vault-id>",
    "hostEnv": "OP_CONNECT_HOST",
    "tokenEnv": "OP_CONNECT_TOKEN"
  },
  "branch": "main",
  "files": [".env", ".env.*", "apps/**/.env*", "secrets/**/*.{json,pem,key}"],
  "ignore": ["**/.env.example", "**/node_modules/**", "**/dist/**"],
  "limits": { "maxFileBytes": 32768, "maxFiles": 100, "concurrency": 4 }
}
```

Selection is glob matching via `picomatch` (dotfiles enabled,
case-sensitive): `files` is an inclusion union, `ignore` always wins, and
`.git/**`, `.repo-toolkit-secret-sync/**`, plus the active config file are
always excluded. Directories matching a `/**`-suffixed ignore (e.g.
`**/node_modules/**`) are pruned from traversal and don't count toward the
10,000-record scan bound; other ignores filter results only. When every `files`
entry is a literal path with no glob characters, discovery stats those paths
directly instead of walking the root. Leading `!` patterns, RegExp values,
absolute paths, and traversal segments are rejected. `--file <path>` selects an exact path inside
the allowed set, is repeatable without comma splitting, and never overrides
excludes. Use `--file=<name>` for dash-leading paths
(e.g. `--file=-leading-name`).

## Connect deployment and auth

A deployed 1Password Connect server is required for the Connect backend. The
endpoint comes from `OP_CONNECT_HOST` and the token from `OP_CONNECT_TOKEN`
by default; config may name alternative environment variables via
`remote.hostEnv` and `remote.tokenEnv`. Tokens never live in config, argv,
plans, output, or errors — only environment variable names are stored. HTTPS
is required except for HTTP loopback (`localhost`, `127.x.x.x`, `::1`). URL
credentials, fragments, and redirects are rejected; authorization is never
sent to a redirected origin. Provisioning Connect infrastructure is out of
scope for this tool; read-only Connect access covers `status`/`pull`/`log`,
while `push`, `rollback`, branch creation, and `resolve` additionally need
write access. `doctor` reports observed read capability only and never claims
write access without a write probe.

## Direct SDK setup (no Connect server)

Select the direct backend per config with `remote.type: "onepassword-sdk"`.
The backend is never inferred from whichever token happens to be set, and
direct operation needs no Connect variables, Docker, the `op` CLI, or a
running Connect endpoint. Two explicit auth modes are supported.

Service-account mode (CI/headless):

```json
{
  "remote": {
    "type": "onepassword-sdk",
    "vaultId": "<1password-vault-id>",
    "auth": { "type": "service-account", "tokenEnv": "OP_SERVICE_ACCOUNT_TOKEN" }
  }
}
```

```sh
repo-toolkit-secret-sync init --config secret-sync.config.json --vault <vault-id> \
  --provider onepassword-sdk --auth service-account --token-env OP_SERVICE_ACCOUNT_TOKEN
```

Desktop mode (local use, approval prompts come from 1Password itself):

```json
{
  "remote": {
    "type": "onepassword-sdk",
    "vaultId": "<1password-vault-id>",
    "auth": { "type": "desktop", "account": "<1password-account-id-or-name>" }
  }
}
```

```sh
repo-toolkit-secret-sync init --config secret-sync.config.json --vault <vault-id> \
  --provider onepassword-sdk --auth desktop --account <1password-account-id-or-name>
```

Prefer a stable account ID where supported; the account selector is passed
through to the SDK and only its non-secret value appears in diagnostics.
Tokens are read from the environment during execution only and never
persisted in config, plans, state, results, errors, or diagnostic JSON. A
denied or cancelled desktop prompt is an authentication error with no
fallback to another account, token, or Connect. Planning, validation, help,
and local-only `init` never initialize or authenticate the SDK; an online
dry run may read but never creates items or changes worktree/state. One SDK
client is created lazily per command execution and shared by concurrent
store calls.

## Moving a Connect worktree to direct access

A config-only provider change refuses to reuse existing state: backend,
vault, or project changes are identity mismatches. Transition with a fresh
worktree and state directory using the same vault and project IDs, then
reconcile preexisting local files through the existing unbased-conflict
rules. The tool never auto-deletes journals, resets a dirty worktree, or
offers an in-place backend-rebind command. Service-account token rotation
and switching auth mode for the same vault/project keep baselines; local
state is `0600` files under a `0700` directory with no tokens, endpoint
credentials, payloads, or sessions.

## Permissions, vault scope, and limits

Service accounts are vault/permission scoped: read-only access covers
`status`/`pull`/`log`, while `push`, `rollback`, branch creation, and
`resolve` need write access, and `doctor` reports observed read capability
only. Service accounts cannot access built-in Personal/Private/Employee
vaults. Desktop approval grants temporary access to the authorized account,
which is broader than the configured vault filter — the tool still lists
only the configured vault. An account lacking the configured vault fails
access checks instead of selecting a similarly named vault.

The file/record bounds are unchanged across backends: 32 KiB per file, 100
files, 64 KiB serialized record, 10,000 records per scan, 256 KiB detail
responses, 30 s timeouts, concurrency default 4 (max 8). Each direct SDK
attempt has one deadline covering its wait for shared lazy initialization
and authentication plus the item or vault request. Settled transient read
failures (including rate limits and provider-reported timeouts) retry up to
three times with bounded backoff. Adapter deadline expiry is non-retryable:
the SDK exposes no cancellation, so underlying initialization or requests
may remain pending after the caller returns. Timeout retries do not multiply
those outstanding calls; independent later calls can still add work.

Pending initialization remains shared, and a late client can serve a still-live
or later caller, but never starts a request for an expired caller. Creates
are never retried. Expiry before the create starts throws a timeout with no
write issued; expiry after it starts returns an uncertain write reconciled
by logical ID, even if the SDK later succeeds or fails. These deadlines bound
asynchronous waiting, not synchronously blocking SDK code.

Service-account quotas differ from Connect: the SDK
surfaces rate limiting as an error with no documented quota numbers, and an
incomplete listing never implies deletion. Live-vault verification of
ceilings, visibility latency, quota numbers, and permission behavior is
still required before any storage-compatibility claim.

## Runtime and platform support

Direct mode needs `@1password/sdk@0.5.0` (MIT) with
`@1password/sdk-core@0.5.0` (MIT, ~14 MB unpacked wasm). The SDK stays
external to the built bundle and ships through the package manager's
production dependency closure; a missing wasm asset fails with an explicit
runtime-assets error that is never disguised as a credential failure.
`engines` requires Node >= 20. The SDK targets Node.js only; desktop IPC is
supported on darwin/linux/win32, and other platform combinations are
unverified against live accounts. Selecting Connect never initializes the
SDK, and `--help` plus every Connect workflow run without SDK
initialization.

## Limits: proposed tool bounds vs verified ceilings

The tool enforces its own bounds, not claimed 1Password limits: 32 KiB per
file, 100 files, 64 KiB serialized record, 10,000 records per scan, 16 MiB
list responses, 256 KiB detail responses, 30 s timeouts, three bounded GET
retries, and concurrency default 4 (max 8). Config can lower the file and
count bounds, never raise them past the hard ceilings. The concealed-field
envelope round-trips empty, binary, multiline, and 32 KiB payloads with byte
equality in synthetic probes; live-vault verification of payload ceilings,
visibility latency, and permission behavior is still required before any
storage-compatibility claim.

Connect's timeout covers each entire attempt, from waiting for headers through
consuming the response body; receiving headers or another chunk does not reset
the deadline. GET timeouts retain at most three retries (four attempts total),
with bounded backoff between attempts. A POST timeout, including a stalled
success body, returns an uncertain write after exactly one attempt and is
never replayed automatically. Redirects remain blocked before body reads.
Abandoned responses are aborted and their bodies cancelled on timeout, early
rejection, retry, or byte-limit failure; reader locks are released. Cleanup is
best-effort and never waits for a hanging cancellation promise. Async headers,
reader/iterator reads, and `response.text()` are deadline-raced even with an
injected implementation that ignores the signal; such underlying work cannot
be forcibly stopped if it also ignores cancellation. Late headers are discarded
and their bodies cancelled. Synchronously blocking injected code cannot be
interrupted by a JavaScript timer.

## Identity, state, retention, branches, recovery, visibility

Remote identity is endpoint plus vault ID plus project ID, pinned in
`.repo-toolkit-secret-sync/state.json` (0700 dir, 0600 files, generated HMAC
key for fingerprints; no bodies, tokens, or plaintext diffs). Changing
identity requires explicit reinitialization. All history is retained in v1;
deletion is a tombstone and pruning is deferred. Branches are organizational
within one vault, not authorization boundaries; use separate vaults for
access separation. Push verifies observed heads before and after
publication; delayed synchronization can reveal another head later,
so success means the commit was verified on the configured endpoint, not
global durability. An ambiguous blob write is first re-found by logical id,
then by byte-identical content, so retrying a push adopts an orphaned blob
from an earlier attempt instead of failing forever or duplicating it.
Local writes are per-file atomic with same-directory temp
files, journaled resume, and exclusive local locks (same-host only).
Pull, restore, rollback, and switch carry the preflight file content or
absence to a final check after temp-file preparation, immediately before
rename. Changed content (including same-length edits), newly created files,
and unexpected removals refuse replacement with `local-changed`. Restore
`--overwrite` permits the preflight content to differ from the requested
revision; it does not authorize later edits to be overwritten. Explicit
`show --export` retains deliberate regular-file overwrite behavior.
Both ordinary and acknowledging restore removals also check the preflight
content or absence before unlink or an absent no-op. Late edits, creations,
and unexpected removals refuse with `local-changed` without advancing baselines
or observed heads, even with `--overwrite`. Ordinary restore of an already
absent target returns without a write; acknowledging restore validates absence
before recording the absent baseline. Pull and switch retain their keyed
removal guards and existing absent no-op behavior.
Pre-rename failures close the temporary handle and attempt to remove the
plaintext temp file, including write, sync, hook, and recheck failures.
This is not filesystem compare-and-swap: edits or ancestor swaps between
the final check and rename or unlink remain possible, as do creations after
an absence check. Filesystem failures or
concurrent directory moves can prevent cleanup. The state lock serializes
cooperating sync operations, not editors or other local writers.
Locks with valid owner metadata remain busy regardless of age while the
owner PID is alive or its liveness cannot be determined (including permission
errors). A confirmed dead owner can be recovered immediately; the 30-second
stale threshold applies only to locks without valid owner metadata. A recycled
PID can conservatively keep a lock busy. Retry after the owning operation
finishes; locks are released only when their ownership nonce still matches.

Rollback requires a clean file at the current remote head. A stale or missing
baseline alone never permits replacing different local content, even when the
remote already points to the requested revision. Before publishing, rollback
atomically saves pending recovery metadata in the identity-bound state file:
operation ID, branch, source/target commit IDs, path, target blob ID, and the
original local HMAC/length or absence. This optional `recovery` field uses the
existing state permissions and contains no file bodies or bare content hashes.
Rerun the same file, branch, and revision after an interrupted publication,
write, or state save; persisted IDs are reused automatically. Recovery requires
the matching remote rollback commit and either the original preimage or the
already-materialized target. Other edits, different retries, and an advanced
remote head are refused with recovery evidence retained. Already-materialized
targets are verified without rewriting; successful baseline acknowledgment
clears recovery in the same atomic state save. Older operation records without
this proof cannot authorize recovery writes. Preserve local edits separately
and reconcile the worktree before retrying; do not delete state to bypass a
refusal.

## CLI

```sh
repo-toolkit-secret-sync init --config secret-sync.config.json --vault <vault-id>
repo-toolkit-secret-sync doctor
repo-toolkit-secret-sync status --check --json
repo-toolkit-secret-sync push --file .env --message "Rotate credentials"
repo-toolkit-secret-sync pull --dry-run
repo-toolkit-secret-sync diff --file .env
repo-toolkit-secret-sync log --file .env --limit 20
repo-toolkit-secret-sync restore --file .env --revision <blob-id>
repo-toolkit-secret-sync rollback --file .env --revision <blob-id> --message "Revert"
repo-toolkit-secret-sync branch list
repo-toolkit-secret-sync branch create --name feature/demo --from main
repo-toolkit-secret-sync switch --branch feature/demo
repo-toolkit-secret-sync resolve --head <A> --head <B> --take <A>
repo-toolkit-secret-sync vault list
repo-toolkit-secret-sync vault list --json
repo-toolkit-secret-sync show --file .env --revision <blob-id>
repo-toolkit-secret-sync show --file .env --export /tmp/out.env
```

The command is the first non-wrapper token (`branch` takes a `list|create`
subcommand); leading wrapper `--` tokens are stripped and remaining
arguments are strict flags. The default command is `status`; `branch` and
`vault` default to `list`. Use `<command> --help` or `<command> -h`, including
`branch create --help`, for required arguments, supported flags, defaults,
alternatives, and examples. Help never loads config, reads credentials, or
initializes the SDK. `init --help`, `vault list --help`, and `doctor --help`
also explain SDK prerequisites.

All commands accept `--config` and `--cwd`. `--json` is supported with the
`show` restrictions below. `--dry-run`, where listed in command help, permits
reads without writes, locks, state, or temp files; `init` has no dry-run flag.
JSON output is schema-versioned and
discriminated (`{ schemaVersion: 1, command, status: 'ok'|'error', ... }`)
with metadata only — never authorization, response bodies, file bytes, or
content fingerprints. Messages and paths are caller metadata and appear in
output. Every failure exits 1.

`restore` requires one file and exactly one of `--revision <blob-id>` or
`--from-branch <name>`; source-branch absence requests local removal. Differing
existing bytes require `--overwrite`. The baseline normally stays unchanged;
`--acknowledge-remote` requires the active branch's current remote target and
acknowledges it. `rollback` instead publishes a new commit and requires one
file, a historical blob ID from `log`, and a clean file at the current head.
`resolve` joins a fork with `--head <A> --head <B> --take <A>`: every head must
match the target branch's observed heads and `--take` must be one of them.
Without `--branch`, it uses the configured branch (`main` when omitted in
config); with `--branch <name>`, it joins only that branch's heads. The join
publishes a new commit without materializing files, switching the active
branch, or changing local bytes and baselines. Stale or wrong-branch heads
refuse without publication, and `--dry-run` plans without remote or local
writes.

## Switching branches with file selection

`switch --branch <name>` and `runSecretSync({ command: 'switch', ... })`
apply the current configured `files` and `ignore` patterns to the union of
baseline, current-branch, and target-branch paths. Only selected paths are
checked for local drift, replaced, removed, or acknowledged. Narrowing the
selection preserves excluded file bytes and their existing baselines, even
when those files are dirty or absent from the target branch. Target-only
excluded files are not created. The config file under the sync root, `.git/`,
and `.repo-toolkit-secret-sync/` remain excluded even with `files: ["**"]`.

The active/materialized branch changes after the selected work completes;
excluded files can still contain bytes from a previous branch. Re-including
them subjects them to the usual drift checks. An empty selection permits a
branch change without changing any file baseline. `switch --dry-run` uses
the same selected cleanliness checks and reports planned `downloaded`,
`removedLocal`, and `acknowledged` paths without writing files, baselines,
branch metadata, locks, or journals.

The low-level `switchBranch` API accepts an optional `matchesPath` predicate.
Omitting it retains its all-tracked-paths default; it does not load config or
apply CLI inclusion defaults. Config-aware callers can supply
`createSelectionMatcher({ files, ignore, extraExcludes })`, including the
root-relative config path in `extraExcludes`.

Before switching files, secret-sync atomically records metadata-only recovery
proof: source/target branches and heads, operation identity, selected actions,
and original local HMAC/length or absence. An interrupted switch retains the
old branches, heads, and baselines until all selected files are verified.
Retry the same target with the same selected paths and unchanged remote heads.
Matching journal entries are checked against actual target bytes or absence;
completed writes/removals are acknowledged without repeating them, including
after a final state-save failure. Unfinished files must still match their
original preimages. Changed completed files, unrelated journals, other targets,
or mismatched operation IDs refuse and retain recovery evidence.

While switch recovery is pending, pull, push, restore (including overwrite),
and rollback refuse local mutation. Resume the switch first. Read-only commands
remain available; switch dry-run verifies the same proof without changing it.
Excluded files and baselines remain untouched during recovery. Proof retirement
and final branch/baseline updates share one atomic state save; recovery metadata
and journals contain no secret bodies or unkeyed content hashes.

## Listing vaults

`vault list` is read-only metadata (`id`, `title`, plus type/item count when the
backend returns them) for discovering the exact `remote.vaultId` to put in
config. It works with both backends and never writes state, locks, or temp files.
No config file is needed — select the backend explicitly:

```sh
OP_SERVICE_ACCOUNT_TOKEN=<sa-token> repo-toolkit-secret-sync vault list --provider onepassword-sdk --auth service-account
repo-toolkit-secret-sync vault list --provider onepassword-sdk --auth desktop --account <account-id-or-name>
OP_CONNECT_HOST=http://127.0.0.1:8080 OP_CONNECT_TOKEN=<token> repo-toolkit-secret-sync vault list --provider onepassword-connect
```

With a config file, the backend comes from the config and no provider flags are
needed: `repo-toolkit-secret-sync vault list --config secret-sync.config.json`.
Service accounts cannot see Personal/Private/Employee vaults.

## Viewing file content without pulling

`show --file <path>` prints one tracked file's verified bytes (length- and
SHA-256-checked) to stdout without touching the worktree, state, or baselines.
Add `--revision <blob-id>` for a historical version (it must have been
associated with that path) or `--branch <name>` to read another branch.
Raw `show` does not support `--json` without `--copy`, `--export`, or
`--dry-run`; redirect to a file
(`show … > /tmp/out`) instead of scrolling secrets, and beware shell history.
With `--interactive`, `show` walks file, revision, then branch pickers
(`@clack/prompts`; already used elsewhere in this repo) instead of requiring
`--file` up front — any flag you do pass pre-answers its step. Cancelling any
picker aborts with a non-zero exit and prints nothing. With `--copy`, the bytes
go to the system clipboard (`pbcopy` on macOS, `clip` on Windows, `wl-copy` /
`xclip` / `xsel` on Linux) and stdout gets only a confirmation; `--copy --json`
emits metadata without bytes. Clipboard contents linger — clear them when done.
With `--export <path>`, the bytes are written atomically with `0600`
permissions instead of printed — a safer `>` that refuses symlinks, special
files, directories, and symlinked ancestors, and overwrites an existing plain
file. Relative destinations resolve against the working directory (`--cwd` when
supplied). `--export` composes with `--copy`, `--revision`, `--branch`, and
`--interactive`; `--export --json` also emits metadata only on a non-dry run.
`show --dry-run` is a metadata-only preview in text or JSON: it performs no
clipboard/export writes, prints no raw bytes, and changes no state, worktree,
or baselines. `--dry-run --json` needs no sink; API dry-run bytes are empty
while `byteLength` reports the verified size and the note names the requested
action. Ordinary raw `show --json` without `--copy`, `--export`, or `--dry-run`
remains rejected.

## Fake-server example without a real vault

```sh
node examples/fake-server.mjs
```

The example starts a loopback fake Connect server, then runs
init, push, status, and pull against it with exact-byte verification.

## Fake-SDK example without a real vault

```sh
node examples/fake-sdk.mjs
```

The example runs service-account and desktop round trips (push, status,
pull) through the real SDK adapter against an in-memory fake SDK client
with exact-byte verification. No vault, credentials, desktop software, or
network access is required. The README and website config examples are
executed in `test/examples.test.ts` against an in-memory fake store.

## JavaScript API

```ts
import { resolveSecretSyncPlan, runSecretSync } from '@repo-toolkit/secret-sync';

const plan = await resolveSecretSyncPlan({ config: 'secret-sync.config.json', command: 'status' });
await runSecretSync({ config: 'secret-sync.config.json', command: 'status' });
```

`resolveSecretSyncPlan(options = {})` returns the validated plan (metadata
only: env names, never token values). `runSecretSync(options = {})` executes
the discriminated command with typed metadata-only results; inject a
`store`, `fetchImpl`, or `env` for tests. Do not put secret values in commit
messages: they are visible in output and history metadata.
