---
sidebar_label: Overview
sidebar_position: 1
---

# `@repo-toolkit/changelog`

Shared conventional changelog preset, generator, and CLI for repository releases.

## Install

```bash npm2yarn
npm install --save-dev @repo-toolkit/changelog
```

## What It Exposes

Main entrypoint (`@repo-toolkit/changelog`):

- `generateChangelog(options)` — run the generator and write the changelog to disk
- `createGenerator(options)` — build a configured `ConventionalChangelog` instance
- `createPreset(options)` — build the conventional-commits preset used by the generator
- `DEFAULT_TYPES` — the default commit-type → section mapping
- `ChangelogConfig` — type alias for the options object

CLI binary: `repo-toolkit-changelog`

## Quick Start

Run the CLI from the repository root:

```sh
repo-toolkit-changelog
```

Programmatic equivalent:

```ts
import { generateChangelog } from '@repo-toolkit/changelog';

await generateChangelog({
  outputFile: 'CHANGELOG.md',
  tagPrefix: 'v',
  issuePrefixes: ['#', 'WEB-'],
  scope: 'api',
});
```

## Package Guide

- [CLI](./cli): flags and default behavior
- [Config File](./config): repo-specific options via `--config`
- [JavaScript API](./javascript-api): `generateChangelog`, `createGenerator`, `createPreset`
- [Preset Options](./preset-options): `types`, `scope`, `ignoreCommits`, URL formatters
- [Default Sections](./default-sections): visible and hidden commit types
