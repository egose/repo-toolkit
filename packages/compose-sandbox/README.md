# `@repo-toolkit/compose-sandbox`

Run a repository-defined Docker Compose test sandbox through a deterministic lifecycle:

```
validate -> prepare -> start -> wait -> test -> collect evidence -> clean up
```

Uses structured `docker compose` commands (executable + argument arrays, no shell), bounded probes, and deterministic cleanup.

## Prerequisites

- Node.js 20 or newer.
- Docker with Compose v2 (`docker compose`) for any non-`--dry-run` execution.
- `--help` and `--dry-run` require neither Docker nor network access.

## Installation

```sh
pnpm add -D @repo-toolkit/compose-sandbox
```

## Configuration (JSON and JavaScript)

Config files are loaded via `@repo-toolkit/publish-package` `loadConfigFile` and may be JSON, `.mjs`, or `.cjs` modules exporting an object (default export for JS). `config` path is resolved relative to `--cwd` when given.

Minimal JSON config (`compose-sandbox.json`):

```json
{
  "cwd": ".",
  "compose": { "files": ["sandbox/docker-compose.yml"] },
  "test": { "executable": "pnpm", "args": ["test"] }
}
```

JavaScript config (`compose-sandbox.config.mjs`) with all top-level keys:

```js
export default {
  cwd: '.',
  compose: {
    files: ['sandbox/docker-compose.yml', 'sandbox/docker-compose.ci.yml'],
    envFile: 'sandbox/.env.dev',
    projectName: 'my-app',
    profiles: ['ci'],
    build: true,
    pull: false,
  },
  prepare: {
    directories: ['sandbox/data/pg', 'sandbox/data/mongo'],
    copies: [{ from: 'sandbox/assets', to: 'sandbox/work/assets' }],
  },
  readiness: [
    { type: 'tcp', host: '127.0.0.1', port: 5432 },
    { type: 'http', url: 'http://127.0.0.1:8080/health' },
    { type: 'service-completed', service: 'minio-init' },
  ],
  test: { executable: 'pnpm', args: ['exec', 'bats', 'tests/'], env: { CI: '1' } },
  evidence: { directory: '.compose-logs', capture: 'onFailure', maxLogBytes: 1048576, stripAnsi: true },
  cleanup: { volumes: true, removeOrphans: true, paths: ['sandbox/data/pg'] },
  timeouts: { startupMs: 120000, readinessMs: 120000, testMs: 300000, cleanupMs: 30000 },
};
```

Reference-shaped working configs — see `website/docs/packages/compose-sandbox.md` for `_database-tools` (mixed TCP/HTTP/one-shot + Bats) and `_vite-fastapi-postgres-template` (three HTTP endpoints + Playwright) examples and isolated `test/fixtures/` consumers.

## CLI

```sh
repo-toolkit-compose-sandbox --help
repo-toolkit-compose-sandbox --config compose-sandbox.json --dry-run
repo-toolkit-compose-sandbox --config compose-sandbox.json
repo-toolkit-compose-sandbox --config compose-sandbox.json --project-name ci-$GITHUB_RUN_ID --evidence-dir .ci-logs
```

| Flag                    | Purpose                                                                       |
| ----------------------- | ----------------------------------------------------------------------------- |
| `--config <path>`       | Config file (JSON, `.mjs`, or `.cjs` default export).                         |
| `--cwd <path>`          | Project root; overrides config `cwd`.                                         |
| `--compose-file <path>` | Repeatable. Overrides `compose.files`.                                        |
| `--project-name <name>` | Overrides `compose.projectName` (must match `^[a-z0-9][a-z0-9_-]*$`).         |
| `--evidence-dir <path>` | Overrides `evidence.directory` (contained under `cwd`).                       |
| `--dry-run`             | Resolve, validate, and print the redacted plan (JSON) without running Docker. |
| `-h, --help`            | Show help and exit 0.                                                         |

`--dry-run` prints a redacted plan: every `test.env` and `readiness[].env` value is replaced with `[REDACTED]`; HTTP `Authorization`/`token`/`secret` headers are redacted. Invalid config exits nonzero with a concise message, no stack trace, and no secrets.

## Phases

1. **validate** — strict type/unknown-key validation, path containment, project/service/URL/port/timeout checks; no I/O.
2. **prepare** — create `prepare.directories` and copy `prepare.copies` (all contained under `cwd`).
3. **preflight** — `docker compose version` check.
4. **start** — `docker compose up -d` (respects `compose.build`/`pull`/`profiles`/`envFile`/`projectName`).
5. **wait** — poll `tcp`, `http` (status-range), `service-running`, `service-completed`, and `command` probes until aggregate `readinessMs` timeout; unsatisfied probes are listed.
6. **test** — run structured `test.executable` + `test.args` with `test.env` and `test.cwd`, live-inherited stdio, `testMs` timeout.
7. **collect evidence** — `docker compose ps -a --format json` -> `ps.json` and `docker compose logs --no-color` -> `logs.txt` (bounded by `evidence.maxLogBytes`, ANSI stripped optionally) plus `result.json` manifest (phase, outcome, timings, evidenceFiles, primary/secondary sanitized errors). Default `capture: onFailure`, or `always`.
8. **clean up** — `docker compose down` (`--volumes`/`--remove-orphans` per `cleanup`) then remove only `cleanup.paths` (contained, non-root, symlink-target-checked). Runs on success, failure, timeout, and `SIGINT`/`SIGTERM`.

## Failure semantics

The first failure is the **primary** error; evidence or cleanup failures are **secondary** and never replace the primary. The CLI and `result.json` surface both (`primary`/`secondary`). Evidence is captured before teardown and bounded; cleanup is idempotent. `runLifecycle` preserves the same guarantee for library callers.

## Signals

`SIGINT`/`SIGTERM` abort the current phase, terminate the child process group where supported, trigger evidence + cleanup once, remove listeners afterwards, and return a non-success result. Repeated library calls do not leak listeners.

## Path boundaries

`compose.files`, `compose.envFile`, `prepare.directories`, `prepare.copies.{from,to}`, `evidence.directory`, `cleanup.paths`, and `test.cwd` must be relative, must not contain `..` segments or NUL bytes, and must resolve inside `cwd`. `cleanup.paths` may not be the project root and sympath targets outside the root are rejected. Plan resolution is side-effect free and does not require files to exist (enables `--dry-run`), but preflight/prepare validate existence before mutation.

## Structured commands

Every process is `spawn(executable, args, { cwd, env })` without a shell. Interpolation into shell source is never performed. Command probes and the test command share the same contract (`executable` required, `args`/`env` optional, `cwd` contained).

## Local / CI examples

Local:

```sh
repo-toolkit-compose-sandbox --config sandbox/compose-sandbox.json --dry-run
repo-toolkit-compose-sandbox --config sandbox/compose-sandbox.json --evidence-dir .compose-logs
```

CI (GitHub Actions, unique project per run, always collect logs):

```yaml
- run: repo-toolkit-compose-sandbox --config sandbox/compose-sandbox.json --project-name ci-${{ github.run_id }} --evidence-dir .ci-logs
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: compose-logs, path: .ci-logs }
```

Matrix builds can pass `--compose-file sandbox/docker-compose.yml --compose-file sandbox/docker-compose.ci.yml` to override the config file list.

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

- `resolveComposeSandboxPlan(options?)` is side-effect free, freezes the plan, and never writes files or spawns processes.
- `runComposeSandbox(options?, deps?)` accepts the same options plus `config`/`dryRun` and injectable `deps` (`clock`, `signalTarget`, `runProcess`, `tcpConnect`, `httpFetch`, `getServiceState`, `fs`).

## Deferred

YAML config, legacy `docker-compose` executable, shared service definitions, GitHub artifact upload/summary, and consumer repository migrations are deferred. The runner is GitHub-independent and never installs Docker, clients, Bats, Playwright, or package managers.
