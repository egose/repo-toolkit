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
`loadConfigFile` helper). Every command loads `./secret-sync.config.json` from
the working directory by default; pass `--config <path>` to use another file
(`vault list --provider …` is the only command that runs without any config):

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
responses, 30 s timeouts, concurrency default 4 (max 8). Direct reads retry
up to three times with bounded backoff; creates are never retried, and a
timeout around a create is an uncertain write reconciled by logical ID, not
evidence of failure. Service-account quotas differ from Connect: the SDK
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
arguments are strict flags. All commands accept `--config`, `--json`, and
`-h`/`--help`. All mutating commands accept `--dry-run` (reads only: no
writes, locks, state, or temp files). JSON output is schema-versioned and
discriminated (`{ schemaVersion: 1, command, status: 'ok'|'error', ... }`)
with metadata only — never authorization, response bodies, file bytes, or
content fingerprints. Messages and paths are caller metadata and appear in
output. Every failure exits 1.

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
`show` prints raw bytes only and does not support `--json`; redirect to a file
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
file. Relative destinations resolve against the invocation directory. `--export`
composes with `--copy`, `--revision`, `--branch`, and `--interactive`.

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
