---
sidebar_label: Config File
sidebar_position: 3
---

# Config File

Use `--config` when you want repo-specific options such as custom commit `types`,
scope filtering, ignored commits, or custom issue and commit URLs.

## Example

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

## JSON vs. JavaScript Config

Use a JavaScript config file (`.mjs`/`.cjs`) when you need `RegExp` values such
as `ignoreCommits` or formatter callbacks such as `formatIssueUrl`. JSON config
files only work for plain data options.

For the full list of supported options, see [Preset Options](./preset-options).
The config file accepts every option documented there, plus the pipeline options
from the [JavaScript API](./javascript-api) (`outputFile`, `tagPrefix`,
`releaseCount`, etc.).
