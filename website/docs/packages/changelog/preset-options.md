---
sidebar_label: Preset Options
sidebar_position: 5
---

# Preset Options

These options are forwarded to the conventional-commits preset and are accepted
by `generateChangelog`, `createGenerator`, `createPreset`, and the [config file](./config).

## `types`

Type: `Array<{ type: string; section?: string; scope?: string; effect?: 'bump' | 'changelog' | 'hidden'; hidden?: boolean }>`

Defines which commit types appear in the changelog and under which section.

- `section` controls the visible heading for matching commits.
- `scope` narrows the rule to commits with that scope (e.g. `fix(deps)`).
- `effect` controls visibility. `'hidden'` omits the type entirely. `'bump'` and
  `'changelog'` are passed through to the upstream preset for bump logic.
- `hidden: true` is the legacy spelling of `effect: 'hidden'` and is still
  accepted for compatibility with older upstream versions.

`effect` is the preferred field.

```ts
{
  types: [
    { type: 'feat', section: 'Features' },
    { type: 'fix', section: 'Bug Fixes' },
    { type: 'build', section: 'Build' },
    { type: 'docs', section: 'Docs' },
    { type: 'chore', effect: 'hidden' },
  ],
}
```

## `ignoreCommits`

Type: `RegExp`

A regex that drops matching commits from the changelog entirely. Only
expressible in a JavaScript config file, not JSON.

```ts
{
  ignoreCommits: /^chore: release candidate /;
}
```

## `issuePrefixes`

Type: `ReadonlyArray<string>`

Tokens that introduce a reference to an issue. Defaults to `['#']`.

```ts
{
  issuePrefixes: ['#', 'WEB-'];
}
```

## `scope`

Type: `string | ReadonlyArray<string>`

Only include commits whose scope matches one of these values. When omitted,
all scopes are included.

```ts
{
  scope: ['api', 'ui'];
}
```

## `scopeOnly`

Type: `boolean`

When `true`, only commits that have a scope are included (combined with `scope`
to filter by those specific scopes). Defaults to `false`.

## `preMajor`

Type: `boolean`

When `true`, the preset operates in pre-major mode (e.g. emit `BREAKING CHANGES`
under a different heading). Defaults to `false`.

## URL Formatters

Customize how issue, commit, compare, and user links are rendered. Each
receives the conventional-changelog context object.

```ts
{
  formatIssueUrl: (context, reference) => `https://jira.example.com/browse/${reference.issue}`,
  formatCommitUrl: (context, commit) => `https://github.com/egose/repo-toolkit/commit/${commit.hash}`,
  formatCompareUrl: (context) => `https://github.com/egose/repo-toolkit/compare/${context.previousTag}...${context.currentTag}`,
  formatUserUrl: (context, user) => `https://github.com/${user}`,
}
```

Only expressible in a JavaScript config file.
