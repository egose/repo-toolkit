# `@repo-toolkit/secret-sync`

Synchronize explicitly selected local files with 1Password Connect, preserving
exact bytes including binary data and line endings.

The long-form guide lives at
<https://repo-toolkit.pages.dev/docs/packages/secret-sync>.

## Installation

```sh
pnpm add -D @repo-toolkit/secret-sync
```

## Configuration

`secret-sync.config.json` (JSON, `.mjs`, or `.cjs` via the shared
`loadConfigFile` helper):

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
always excluded. Leading `!` patterns, RegExp values, absolute paths, and
traversal segments are rejected. `--file <path>` selects an exact path inside
the allowed set, is repeatable without comma splitting, and never overrides
excludes. Use `--file=<name>` for dash-leading paths
(e.g. `--file=-leading-name`).

## Connect deployment and auth

A deployed 1Password Connect server is required. The endpoint comes from
`OP_CONNECT_HOST` and the token from `OP_CONNECT_TOKEN` by default; config
may name alternative environment variables via `remote.hostEnv` and
`remote.tokenEnv`. Tokens never live in config, argv, plans, output, or
errors — only environment variable names are stored. HTTPS is required
except for HTTP loopback (`localhost`, `127.x.x.x`, `::1`). URL credentials,
fragments, and redirects are rejected; authorization is never sent to a
redirected origin. Provisioning Connect infrastructure is out of scope for
this tool; read-only Connect access covers `status`/`pull`/`log`, while
`push`, `rollback`, branch creation, and `resolve` additionally need write
access. `doctor` reports observed read capability only and never claims
write access without a write probe.

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
publication; delayed Connect synchronization can reveal another head later,
so success means the commit was verified on the configured endpoint, not
global durability. Local writes are per-file atomic with same-directory temp
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

## Fake-server example without a real vault

```sh
node examples/fake-server.mjs
```

The example starts a loopback fake Connect server, then runs
init, push, status, and pull against it with exact-byte verification. The
README and website config examples are executed in `test/examples.test.ts`
against an in-memory fake store.

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
