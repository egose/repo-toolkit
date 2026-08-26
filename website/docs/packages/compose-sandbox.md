---
sidebar_label: Compose Sandbox
sidebar_position: 7
---

# `@repo-toolkit/compose-sandbox`

`@repo-toolkit/compose-sandbox` runs a repository-defined Docker Compose test sandbox through a deterministic lifecycle:

```text
validate -> prepare -> start -> wait -> test -> collect evidence -> clean up
```

The runner uses structured `docker compose` commands (executable + argument arrays, no shell), bounded probes, and deterministic cleanup. It is usable from a developer shell and from a thin wrapper in `_egose-actions` without knowing about PostgreSQL, MongoDB, MinIO, Keycloak, Playwright, Bats, or GitHub Actions.

## Requirements

- Node.js 20 or newer.
- Docker with Compose v2 (`docker compose`) for any non-`--dry-run` execution.

`--dry-run` and `--help` require neither Docker nor network access. No YAML runtime dependency in the first release; JSON and JavaScript config only.

## Install

```sh
pnpm add -D @repo-toolkit/compose-sandbox
```

Root script:

```sh
pnpm compose-sandbox -- --help
```

## CLI

```sh
repo-toolkit-compose-sandbox --help
repo-toolkit-compose-sandbox --config compose-sandbox.json --dry-run
repo-toolkit-compose-sandbox --config compose-sandbox.mjs --project-name ci-$GITHUB_RUN_ID --evidence-dir .ci-logs
```

| Flag                    | Purpose                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--config <path>`       | Config file (JSON, `.mjs`, or `.cjs` default export). Resolved via `@repo-toolkit/publish-package` `loadConfigFile`. |
| `--cwd <path>`          | Project root; overrides config `cwd`.                                                                                |
| `--compose-file <path>` | Repeatable. Overrides `compose.files`.                                                                               |
| `--project-name <name>` | Overrides `compose.projectName` (`^[a-z0-9][a-z0-9_-]*$`, ≤64 chars).                                                |
| `--evidence-dir <path>` | Overrides `evidence.directory` (contained under `cwd`).                                                              |
| `--dry-run`             | Resolve, validate, and print the redacted plan (JSON) without running Docker.                                        |
| `-h, --help`            | Show help and exit 0.                                                                                                |

`--dry-run` prints a redacted plan (`test.env` and `readiness[].env` values -> `[REDACTED]`, HTTP auth/token headers -> `[REDACTED]`) to stdout and exits 0 without spawning Docker. Invalid config exits nonzero with a concise message, no stack trace, and no secrets. `--config` JS execution trusts the config as repository code; `--config` JSON is parsed via `JSON.parse`.

Overrides are intentionally narrow: only `cwd`, `compose.files`, `compose.projectName`, `evidence.directory`, and `dryRun` are CLI-overridable; all other behavior belongs in the config file.

## Lifecycle

| Phase                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Failure handling                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **validate**         | Strict runtime type checks, unknown-key rejection, duplicate-probe rejection, project/service/URL/port/timeout/env validation, relative-path + `..` + NUL + containment checks. No I/O.                                                                                                                                                                                                                                                                                                    | Returns primary immediately; no side effects.                                                                                       |
| **prepare**          | Create `prepare.directories` and copy `prepare.copies` (`from` -> `to`) under `cwd` after validating sources.                                                                                                                                                                                                                                                                                                                                                                              | Primary preserved; evidence + cleanup still run.                                                                                    |
| **preflight**        | `docker compose version` check using `compose.executable` (`docker` by default).                                                                                                                                                                                                                                                                                                                                                                                                           | Primary preserved.                                                                                                                  |
| **start**            | `docker compose up -d` with `--build`/`--pull`/`--profile`/`--env-file`/`--project-name` per plan.                                                                                                                                                                                                                                                                                                                                                                                         | Primary preserved.                                                                                                                  |
| **wait**             | Poll probes until `timeouts.readinessMs` (default 120s): `tcp` (connect), `http` (status range `expectedStatus`, default `200-299`), `service-running`, `service-completed` (exit code 0 with actionable state/exit-code diagnostics), `command` (structured probe, `timeoutMs` 30s default). Independent probes run concurrently with cancellation-safe diagnostics.                                                                                                                      | Timeout lists every unsatisfied probe; failed one-shot fails immediately with `ServiceProbeError` including service/state/exitCode. |
| **test**             | `spawn(test.executable, test.args, { cwd: test.resolvedCwd ?? cwd, env: { ...process.env, ...test.env } })`, `inheritStdio: true`, `timeoutMs: timeouts.testMs` (default 300s). Runs only after all readiness passes.                                                                                                                                                                                                                                                                      | Nonzero exit code -> primary `exitCode`; timeout -> primary timedOut.                                                               |
| **collect evidence** | If `evidence.capture === 'always'` or outcome is failure, `docker compose ps -a --format json` -> `ps.json` and `docker compose logs --no-color` -> `logs.txt` (bounded by `evidence.maxLogBytes`, default 1 MiB, max 10 MiB, ANSI stripped if `stripAnsi`). Writes `result.json` manifest `{ phase, outcome, timings, evidenceFiles, errors: { primary, secondary } }` with sanitized (ANSI-stripped, truncated, redacted) messages, no env secrets. Evidence is written before teardown. | Evidence failure becomes primary if no earlier failure, otherwise secondary.                                                        |
| **clean up**         | `docker compose down` (`--volumes`/`--remove-orphans` per `cleanup`) then `rm -rf` each `cleanup.paths` (contained, non-root, symlink-target-inside-project-checked, idempotent). Runs on success, failure, timeout, and `SIGINT`/`SIGTERM`; at most once and only after `start` began. `cleanupMs` default 30s.                                                                                                                                                                           | Cleanup failure never replaces primary; reported as secondary.                                                                      |

`timeouts.totalMs` (optional) aborts the whole lifecycle via a single `AbortController`; `startupMs`/`readinessMs`/`testMs`/`cleanupMs` bound individual phases. Signal handlers for `SIGINT`/`SIGTERM` are registered per `runLifecycle` invocation and removed afterwards (no cross-call leaks). Child processes are terminated via process-group where supported.

## Configuration reference

Configuration is a plain object (JSON or JS default export). Unknown keys are rejected at any level.

```ts
type ComposeSandboxOptions = {
  cwd?: string; // default '.'
  compose: {
    executable?: string; // default 'docker'
    files: string[]; // required, >=1, relative, contained
    envFile?: string; // relative, contained
    projectName?: string; // ^[a-z0-9][a-z0-9_-]*$
    profiles?: string[]; // service-name shaped
    build?: boolean;
    pull?: boolean;
  };
  prepare?: {
    directories?: string[]; // relative, contained, not '.'
    copies?: Array<{ from: string; to: string }>; // both relative, contained, not '.'
  };
  readiness?: Array<
    | { type: 'tcp'; host: string; port: number; timeoutMs?: number; intervalMs?: number }
    | {
        type: 'http';
        url: string;
        method?: string;
        expectedStatus?: number | number[] | [number, number];
        headers?: Record<string, string>;
        timeoutMs?: number;
        intervalMs?: number;
      }
    | { type: 'service-running'; service: string; timeoutMs?: number; intervalMs?: number }
    | { type: 'service-completed'; service: string; timeoutMs?: number; intervalMs?: number }
    | { type: 'command'; executable: string; args?: string[]; env?: Record<string, string>; timeoutMs?: number }
  >;
  test: { executable: string; args?: string[]; env?: Record<string, string>; cwd?: string };
  evidence?: { directory?: string; capture?: 'always' | 'onFailure'; maxLogBytes?: number; stripAnsi?: boolean };
  cleanup?: { volumes?: boolean; removeOrphans?: boolean; paths?: string[] };
  timeouts?: { startupMs?: number; readinessMs?: number; testMs?: number; cleanupMs?: number; totalMs?: number };
  dryRun?: boolean;
  config?: string; // CLI only: path to config file
};
```

Defaults: `evidence.directory='.compose-sandbox-logs'`, `capture='onFailure'`, `maxLogBytes=1_048_576`, `stripAnsi=true`, `cleanup.removeOrphans=true`, `timeouts={ startupMs: 120000, readinessMs: 120000, testMs: 300000, cleanupMs: 30000 }`, probe `timeoutMs=5000`/`intervalMs=1000` (command 30000), `compose.executable='docker'`.

Path rules: every configurable path is normalized (backslash->slash, `.` segments removed), must be relative, must not contain `..` or NUL, must resolve inside `cwd`. `cleanup.paths` duplicates and project-root targets rejected. Symmetric validation ensures plan resolution is side-effect free and supports `--dry-run` without requiring files to exist.

Security boundaries: structured commands never evaluated as shell source; config is trusted repository code but still validated; environment secrets are redacted from dry-run output, logs, and `result.json` errors; HTTP `Authorization`/`token`/`secret` headers are redacted; cleanup cannot escape the project (including via symlink targets).

## Working configurations (reference repositories)

### `_database-tools` shape — mixed TCP/HTTP/one-shot + Bats

Original sandbox: two Compose files (`sandbox/docker-compose.yml` + `sandbox/docker-compose-ci.yml`), env file, TCP checks for Postgres/Mongo, HTTP for MinIO, one-shot `minio-init` completion, Bats test command. Isolated fixture: `test/fixtures/database-tools-shaped/`.

```js
// compose-sandbox.database-tools.config.mjs
export default {
  cwd: '.',
  compose: {
    files: ['sandbox/docker-compose.yml', 'sandbox/docker-compose-ci.yml'],
    envFile: 'sandbox/.env.dev',
    projectName: 'database-tools',
  },
  prepare: {
    directories: ['sandbox/data/pg', 'sandbox/data/mongo', 'sandbox/data/minio'],
  },
  readiness: [
    { type: 'tcp', host: '127.0.0.1', port: 5432 },
    { type: 'tcp', host: '127.0.0.1', port: 27017 },
    { type: 'http', url: 'http://127.0.0.1:9000/minio/health/live' },
    { type: 'service-completed', service: 'minio-init' },
  ],
  test: { executable: 'pnpm', args: ['exec', 'bats', 'tests/integration'] },
  evidence: { directory: '.compose-logs', capture: 'onFailure' },
  cleanup: { volumes: true, removeOrphans: true, paths: ['sandbox/data/pg', 'sandbox/data/mongo'] },
};
```

Equivalent JSON is valid. `--dry-run` validates without Docker; CI uses `--project-name database-tools-${{ github.run_id }}` for isolation.

### `_vite-fastapi-postgres-template` shape — multiple HTTP endpoints + Playwright

Original sandbox: Compose files (`sandbox/docker-compose.yml` + `sandbox/docker-compose-apps.yml`), HTTP for Keycloak (`/realms/master`), API (`/api/v1/info`), frontend, Playwright test command. Isolated fixture: `test/fixtures/vite-fastapi-shaped/`.

```js
// compose-sandbox.vite-fastapi.config.mjs
export default {
  cwd: '.',
  compose: {
    files: ['sandbox/docker-compose.yml', 'sandbox/docker-compose-apps.yml'],
    projectName: 'vfpt',
  },
  readiness: [
    { type: 'http', url: 'http://127.0.0.1:8080/realms/master', expectedStatus: 200 },
    { type: 'http', url: 'http://127.0.0.1:8000/api/v1/info' },
    { type: 'http', url: 'http://127.0.0.1:3000', expectedStatus: [200, 299] },
  ],
  test: { executable: 'pnpm', args: ['playwright:test'] },
  evidence: { directory: '.ci-logs', capture: 'always' },
  cleanup: { volumes: true, removeOrphans: true },
};
```

Both fixtures are validated by `test/fixtures.test.ts` and exercised by the real-Compose integration test without requiring the full source trees.

## Library

```ts
import { resolveComposeSandboxPlan, runComposeSandbox } from '@repo-toolkit/compose-sandbox';

const plan = resolveComposeSandboxPlan({
  cwd: '.',
  compose: { files: ['docker-compose.yml'] },
  test: { executable: 'pnpm', args: ['test'] },
});

await runComposeSandbox({ config: './compose-sandbox.json', cwd: '.' });
await runComposeSandbox({
  cwd: '.',
  compose: { files: ['a.yml'] },
  test: { executable: 'echo', args: ['hi'] },
  dryRun: true,
});
```

- `resolveComposeSandboxPlan(options?)` is side-effect free, deep-freezes the plan, never touches the filesystem or network.
- `runComposeSandbox(options?, deps?)` injects `clock`, `signalTarget`, `createAbortController`, `runProcess`, `tcpConnect`, `httpFetch`, `getServiceState`, `runCommandProbe`, and `fs` for isolated unit/integration testing.

## Local / CI examples

Local dry-run (no Docker):

```sh
repo-toolkit-compose-sandbox --config compose-sandbox.json --dry-run | jq .
```

Local with evidence always captured:

```sh
repo-toolkit-compose-sandbox --config compose-sandbox.json --evidence-dir .compose-logs
cat .compose-logs/result.json | jq .
```

GitHub Actions (GitHub-hosted Linux, Docker available), forced failure + leak check verified by `test/real-compose.test.ts`:

```yaml
jobs:
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm compose-sandbox -- --config compose-sandbox.json --project-name ci-${{ github.run_id }} --evidence-dir .ci-logs
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: compose-logs, path: .ci-logs }
```

## Deferred

- YAML configuration (deferred; add only after demonstrated demand and an explicit runtime-dependency decision).
- Legacy `docker-compose` (Python) executable — use `docker compose` only.
- Shared/published Compose service definitions.
- GitHub artifact upload, summary, or environment-variable dependency.
- Automatic Make/shell-snippet translation or consumer repository migrations.
- Swarm/Kubernetes/Podman Compose.

The runner is GitHub-independent and never installs service-specific clients, `mongosh`, Bats, Playwright, or package managers.
