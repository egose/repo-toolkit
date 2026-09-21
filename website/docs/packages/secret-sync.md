---
sidebar_label: Secret Sync
sidebar_position: 8
---

# `@repo-toolkit/secret-sync`

`@repo-toolkit/secret-sync` synchronizes explicitly selected local files with 1Password Connect or directly with the official 1Password SDK, preserving exact bytes including binary data and line endings.

## Install

```sh
pnpm add -D @repo-toolkit/secret-sync
```

## Configuration

`secret-sync.config.json` (JSON, `.mjs`, or `.cjs` via the shared `loadConfigFile` helper):

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
  "limits": {
    "maxFileBytes": 32768,
    "maxFiles": 100,
    "concurrency": 4
  }
}
```

Branch names match `[A-Za-z0-9][A-Za-z0-9._/-]{0,127}` with empty, `.`, and `..` segments rejected. Limits can only lower the hard ceilings (32 KiB per file, 100 files, concurrency 8). Tokens never live in config or plans — only environment variable names.

## Selection

Selection is glob matching via `picomatch` (dotfiles enabled, case-sensitive): `files` is an inclusion union, `ignore` always wins, and `.git/**`, `.repo-toolkit-secret-sync/**`, plus the active config file are always excluded. `--file <path>` selects an exact path inside the allowed set, is repeatable without comma splitting, and never overrides excludes. Use `--file=<name>` for dash-leading paths (e.g. `--file=-leading-name`).

## Connect deployment and auth

A deployed 1Password Connect server is required for the Connect backend. The endpoint comes from `OP_CONNECT_HOST` and the token from `OP_CONNECT_TOKEN` by default; config may name alternative environment variables. Tokens never live in config, argv, plans, output, or errors. HTTPS is required except for HTTP loopback. URL credentials, fragments, and redirects are rejected. Provisioning Connect infrastructure is out of scope. Read-only Connect access covers `status`/`pull`/`log`; `push`, `rollback`, branch creation, and `resolve` need write access. `doctor` reports observed read capability only and never claims write access without a write probe.

## Direct SDK setup (no Connect server)

Select the direct backend per config with `remote.type: "onepassword-sdk"`. The backend is never inferred from whichever token happens to be set, and direct operation needs no Connect variables, Docker, the `op` CLI, or a running Connect endpoint. Two explicit auth modes are supported.

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

Prefer a stable account ID where supported; the account selector is passed through to the SDK and only its non-secret value appears in diagnostics. Tokens are read from the environment during execution only and never persisted in config, plans, state, results, errors, or diagnostic JSON. A denied or cancelled desktop prompt is an authentication error with no fallback to another account, token, or Connect. Planning, validation, help, and local-only `init` never initialize or authenticate the SDK; an online dry run may read but never creates items or changes worktree/state. One SDK client is created lazily per command execution and shared by concurrent store calls.

## Moving a Connect worktree to direct access

A config-only provider change refuses to reuse existing state: backend, vault, or project changes are identity mismatches. Transition with a fresh worktree and state directory using the same vault and project IDs, then reconcile preexisting local files through the existing unbased-conflict rules. The tool never auto-deletes journals, resets a dirty worktree, or offers an in-place backend-rebind command. Service-account token rotation and switching auth mode for the same vault/project keep baselines; local state is `0600` files under a `0700` directory with no tokens, endpoint credentials, payloads, or sessions.

## Permissions, vault scope, and limits

Service accounts are vault/permission scoped: read-only access covers `status`/`pull`/`log`, while `push`, `rollback`, branch creation, and `resolve` need write access, and `doctor` reports observed read capability only. Service accounts cannot access built-in Personal/Private/Employee vaults. Desktop approval grants temporary access to the authorized account, which is broader than the configured vault filter — the tool still lists only the configured vault. An account lacking the configured vault fails access checks instead of selecting a similarly named vault.

The file/record bounds are unchanged across backends: 32 KiB per file, 100 files, 64 KiB serialized record, 10,000 records per scan, 256 KiB detail responses, 30 s timeouts, concurrency default 4 (max 8). Direct reads retry up to three times with bounded backoff; creates are never retried, and a timeout around a create is an uncertain write reconciled by logical ID, not evidence of failure. Service-account quotas differ from Connect: the SDK surfaces rate limiting as an error with no documented quota numbers, and an incomplete listing never implies deletion. Live-vault verification of ceilings, visibility latency, quota numbers, and permission behavior is still required before any storage-compatibility claim.

## Runtime and platform support

Direct mode needs `@1password/sdk@0.5.0` (MIT) with `@1password/sdk-core@0.5.0` (MIT, ~14 MB unpacked wasm). The SDK stays external to the built bundle and ships through the package manager's production dependency closure; a missing wasm asset fails with an explicit runtime-assets error that is never disguised as a credential failure. `engines` requires Node >= 20. The SDK targets Node.js only; desktop IPC is supported on darwin/linux/win32, and other platform combinations are unverified against live accounts. Selecting Connect never initializes the SDK, and `--help` plus every Connect workflow run without SDK initialization.

## Limits: proposed tool bounds vs verified ceilings

Tool bounds (not claimed 1Password limits): 32 KiB per file, 100 files, 64 KiB serialized record, 10,000 records per scan, 16 MiB list responses, 256 KiB detail responses, 30 s timeouts, three bounded GET retries, concurrency default 4 (max 8). Config can lower file and count bounds, never raise them. Synthetic probes round-trip empty, binary, multiline, and 32 KiB payloads with byte equality; live-vault verification of ceilings, visibility latency, and permission behavior is still required before any storage-compatibility claim.

## Identity, state, retention, branches, recovery, visibility

Remote identity (endpoint plus vault ID plus project ID) is pinned in `.repo-toolkit-secret-sync/state.json` (0700 dir, 0600 files, generated HMAC key; no bodies, tokens, or diffs). Changing identity requires reinitialization. History is retained in v1; deletion is a tombstone and pruning is deferred. Branches are organizational within one vault, not authorization boundaries; use separate vaults for access separation. Push checks observed heads before and after publication; delayed synchronization can reveal another head later, so success means verification on the configured endpoint, not global durability. Local writes are per-file atomic with journaled resume and same-host locks.

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
```

The command is the first non-wrapper token (`branch` takes a `list|create` subcommand); leading wrapper `--` tokens are stripped and remaining arguments are strict flags. All commands accept `--config`, `--json`, and `-h`/`--help`. Mutating commands accept `--dry-run` (reads only: no writes, locks, state, or temp files). JSON output is schema-versioned and discriminated with metadata only. Messages and paths are caller metadata and appear in output; do not put secret values in commit messages. Every failure exits 1.

## Listing vaults

`vault list` prints the `id` and `title` of every vault visible to the credential on either backend, for discovering `remote.vaultId`. It is read-only (no state, lock, or temp writes) and supports `--json`. No config file is needed when the backend is given explicitly:

```sh
OP_SERVICE_ACCOUNT_TOKEN=<sa-token> repo-toolkit-secret-sync vault list --provider onepassword-sdk --auth service-account
repo-toolkit-secret-sync vault list --provider onepassword-sdk --auth desktop --account <account-id-or-name>
OP_CONNECT_HOST=http://127.0.0.1:8080 OP_CONNECT_TOKEN=<token> repo-toolkit-secret-sync vault list --provider onepassword-connect
```

Service accounts cannot see Personal/Private/Employee vaults.

## Fake-server example without a real vault

```sh
node examples/fake-server.mjs
```

The example starts a loopback fake Connect server, then runs init, push, status, and pull with exact-byte verification.

## Fake-SDK example without a real vault

```sh
node examples/fake-sdk.mjs
```

The example runs service-account and desktop round trips (push, status, pull) through the real SDK adapter against an in-memory fake SDK client with exact-byte verification. No vault, credentials, desktop software, or network access is required. The config examples above are executed in `test/examples.test.ts` against an in-memory fake store, and the shipped record format is a versioned JSON envelope (Secure Note with a concealed `payload` field; titles and tags carry only the tool marker, project ID, record kind, and opaque ID).
