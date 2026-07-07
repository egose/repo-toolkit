# `@repo-toolkit/changelog`

Shared conventional changelog preset, generator, and CLI for repository releases.

## Installation

```sh
pnpm add -D @repo-toolkit/changelog
```

## Config File

Use `--config` when you want repo-specific options such as custom commit `types`,
scope filtering, ignored commits, or custom issue and commit URLs.

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

Use a JavaScript config file when you need `RegExp` values such as `ignoreCommits`
or formatter callbacks such as `formatIssueUrl`. JSON config files only work for
plain data options.

## CLI

```sh
repo-toolkit-changelog
```

Useful flags:

- `--config <path>`
- `--cwd <path>`
- `--output <path>`
- `--tag-prefix <prefix>`
- `--release-count <number>`
- `--first-release`
- `--no-skip-unstable`
- `--no-output-unreleased`

## JavaScript API

```ts
import { generateChangelog } from '@repo-toolkit/changelog';

await generateChangelog({
  outputFile: 'CHANGELOG.md',
  tagPrefix: 'v',
  issuePrefixes: ['#', 'WEB-'],
  scope: 'api',
});
```

## Supported Preset Options

- `types`
- `ignoreCommits`
- `issuePrefixes`
- `scope`
- `scopeOnly`
- `preMajor`
- `formatIssueUrl`
- `formatCommitUrl`
- `formatCompareUrl`
- `formatUserUrl`

## Default Sections

- `feat` -> `Features`
- `fix` -> `Bug Fixes`
- `docs` -> `Docs`
- `refactor` -> `Refactors`
- `e2e` -> `End-to-end Testing`

Hidden by default:

- `fix(deps)`
- `chore`
- `style`
- `perf`
- `test`

`effect` is the preferred field for commit-type visibility. `hidden` is still accepted for compatibility with older upstream versions.
