# `@repo-toolkit/changelog`

Shared conventional changelog preset, generator, and CLI for repository releases.

## Installation

```sh
pnpm add -D @repo-toolkit/changelog
```

## Config File

Use `--config` when you want repo-specific options such as custom commit `types`,
scope filtering, ignored commits, or custom URL formats.

```js
/** @type {import('@repo-toolkit/changelog').ChangelogConfig} */
export default {
  ignoreCommits: /^chore: release candidate /,
  issuePrefixes: ['#', 'WEB-'],
  scope: ['api', 'ui'],
  scopeOnly: true,
  types: [
    { type: 'feat', section: 'Features' },
    { type: 'fix', section: 'Bug Fixes' },
    { type: 'build', section: 'Build' },
    { type: 'docs', section: 'Docs' },
    { type: 'chore', effect: 'hidden' },
  ],
};
```

Run it with:

```sh
repo-toolkit-changelog --config changelog.config.mjs
```

CLI flags override values from the config file.

Use a JavaScript config file when you need `RegExp` values such as `ignoreCommits`.
JSON config files only work for plain data options.

> **Warning:** A JavaScript config file (`.mjs`, `.js`, `.cjs`) is loaded with
> `import()`, so it executes as trusted code in the same Node process as the
> CLI. Only point `--config` at files you control. JSON config files are parsed
> with `JSON.parse` and do not execute.

Both JSON and JS config files must export an object whose shape matches
`ChangelogConfig`. Runtime validation rejects unknown top-level keys, unknown
fields on `types` entries, and unsupported `effect` values (only `'hidden'` is
recognized) before the generator is built — invalid configs fail fast with an
actionable error instead of a silent later surprise.

## CLI

```sh
repo-toolkit-changelog
```

All flags:

| Flag                                             | Description                                                                                              | Default                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `--config <path>`                                | Config file (JSON or JS module) with changelog options. JS modules execute trusted code.                 | none                            |
| `--cwd <path>`                                   | Working directory for reading `package.json` and git metadata.                                           | `process.cwd()`                 |
| `--output <path>`                                | Output file path (absolute or relative to `--cwd`).                                                      | `CHANGELOG.md`                  |
| `--tag-prefix <prefix>`                          | Tag prefix to match. Pass `--tag-prefix=` for an empty prefix.                                           | `v`                             |
| `--release-count <non-negative integer>`         | Number of releases to include. `0` regenerates all releases.                                             | latest release only             |
| `--append` / `--no-append`                       | Append generated content after the existing file. Without this flag, generated content is prepended.     | `--no-append` (prepend)         |
| `--first-release` / `--no-first-release`         | Include all commits back to the first tag when no prior release tag exists. Overrides `--release-count`. | `--no-first-release`            |
| `--skip-unstable` / `--no-skip-unstable`         | Skip prerelease tags (e.g. `v1.0.0-beta.1`).                                                             | `--skip-unstable` (skip)        |
| `--output-unreleased` / `--no-output-unreleased` | Include the unreleased section.                                                                          | `--output-unreleased` (include) |
| `-h`, `--help`                                   | Show help and exit.                                                                                      | —                               |

Invalid numeric `--release-count` values exit nonzero with `Invalid numeric value`,
and unsupported config fields exit nonzero with a precise field-level message.

`--first-release` takes precedence over `--release-count` and regenerates the
full changelog. Unknown arguments are rejected by default; use `--` to pass
through trailing args to nested tooling in non-strict mode only.

## Output semantics

`generateChangelog` writes the resulting changelog atomically: it composes the
generated content into a sibling temporary file and renames it over the
destination only after the generator stream completes successfully. If the
generator throws, the existing file is left untouched and the temp file is
removed.

Existing file behavior:

- **Default (prepend):** generated content is placed above the existing content,
  separated by a single blank line. Excess trailing newlines on either side are
  collapsed to keep the separator stable.
- **`--append`:** generated content is placed below the existing content, also
  separated by a single blank line.
- **No existing file:** the generated content is written directly to the
  destination; no merge is performed.
- **Empty generated content:** the existing file is left unchanged.

The output always ends with a single trailing newline.

## JavaScript API

```ts
import {
  generateChangelog,
  createGenerator,
  createPreset,
  getDefaultTypes,
  DEFAULT_TYPES,
} from '@repo-toolkit/changelog';

await generateChangelog({
  outputFile: 'CHANGELOG.md',
  tagPrefix: 'v',
  issuePrefixes: ['#', 'WEB-'],
  scope: 'api',
});
```

### Public exports

| Export                                                      | Kind           | Signature                                                                                                 | Returns                                                              |
| ----------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `generateChangelog`                                         | async function | `(options?: GenerateChangelogOptions) => Promise<string>`                                                 | Resolves with the absolute path of the written changelog file.       |
| `createGenerator`                                           | async function | `(options?: GenerateChangelogOptions) => Promise<ConventionalChangelog>`                                  | Resolves with the configured `conventional-changelog` generator.     |
| `createPreset`                                              | async function | `(options?: CreatePresetOptions) => Promise<ConventionalCommitsPreset & { name: 'conventionalcommits' }>` | Resolves with the preset, tagged with `name: 'conventionalcommits'`. |
| `getDefaultTypes`                                           | function       | `() => ReadonlyArray<Readonly<ChangelogType>>`                                                            | Returns the frozen `DEFAULT_TYPES` array (same reference each call). |
| `DEFAULT_TYPES`                                             | constant       | `ReadonlyArray<Readonly<ChangelogType>>`                                                                  | Deeply frozen default `types` array.                                 |
| `GenerateChangelogOptions`                                  | interface      | extends `CreatePresetOptions`                                                                             | —                                                                    |
| `CreatePresetOptions`                                       | type alias     | = `ConventionalCommitsPresetOptions`                                                                      | —                                                                    |
| `ChangelogConfig`                                           | type alias     | = `GenerateChangelogOptions`                                                                              | Config file shape.                                                   |
| `ChangelogType`                                             | interface      | `{ type, section?, scope?, effect?: 'hidden', hidden? }`                                                  | —                                                                    |
| `ConventionalCommitsPresetOptions`                          | interface      | —                                                                                                         | Mirrors the pinned conventionalcommits API.                          |
| `ChangelogContext`, `ChangelogReference`, `ChangelogCommit` | interfaces     | —                                                                                                         | Echoed from the upstream parser/writer contracts.                    |

### Defaults immutability

`DEFAULT_TYPES` is deeply frozen at module load: nested entries cannot be
mutated, even in strict mode. Use `getDefaultTypes()` if you need a stable
accessor. Mutating attempts throw instead of silently corrupting later preset
creation.

### `effect` contract

`effect` is the preferred field for visibility control on a `ChangelogType`.
Only `'hidden'` is supported — it maps to `hidden: true` for the upstream
conventionalcommits parser. The `hidden` boolean is still accepted on a type
entry for compatibility with older upstream versions.

## Supported Preset Options

- `types`
- `ignoreCommits`
- `issuePrefixes`
- `scope`
- `scopeOnly`
- `preMajor`
- `issueUrlFormat`
- `commitUrlFormat`
- `compareUrlFormat`
- `userUrlFormat`
- `bumpStrict`

## Default Sections

- `feat` -> `Features`
- `fix` -> `Bug Fixes`
- `revert` -> `Reverts`
- `docs` -> `Documentation`
- `refactor` -> `Code Refactoring`
- `perf` -> `Performance Improvements`
- `build` -> `Build System`
- `e2e` -> `End-to-end Testing`

Hidden by default:

- `fix(deps)`
- `ci`
- `chore`
- `style`
- `test`
- `release`

`effect` is the preferred field for commit-type visibility. `hidden` is still accepted for compatibility with older upstream versions.
