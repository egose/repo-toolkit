---
sidebar_label: JavaScript API
sidebar_position: 4
---

# JavaScript API

## `generateChangelog(options)`

Runs the generator and writes the changelog to disk. Returns a promise that
resolves to the absolute output path.

```ts
import { generateChangelog } from '@repo-toolkit/changelog';

await generateChangelog({
  outputFile: 'CHANGELOG.md',
  tagPrefix: 'v',
  issuePrefixes: ['#', 'WEB-'],
  scope: 'api',
});
```

The working directory is switched to `options.cwd` (default `process.cwd()`)
while the generator runs and restored afterward, so git metadata is read from
the intended repository.

### Pipeline Options

| Option             | Default         | Description                                          |
| ------------------ | --------------- | ---------------------------------------------------- |
| `cwd`              | `process.cwd()` | Working directory for git metadata                   |
| `outputFile`       | `CHANGELOG.md`  | Output file path (relative to `cwd`, or absolute)    |
| `append`           | `false`         | Append to the output instead of prepending           |
| `releaseCount`     | `0`             | Number of releases to include (`0` = all)            |
| `skipUnstable`     | `true`          | Skip unstable (prerelease) releases                  |
| `outputUnreleased` | `true`          | Include an unreleased section                        |
| `tagPrefix`        | `v`             | Tag prefix to match                                  |
| `firstRelease`     | `false`         | Include all commits when no prior release tag exists |

The remaining options are forwarded to the preset — see [Preset Options](./preset-options).

## `createGenerator(options)`

Builds a configured `ConventionalChangelog` instance without writing to disk.
Useful when you want to pipe the stream yourself or introspect the generator.

Pipeline-only options (`cwd`, `outputFile`, `append`, `releaseCount`,
`skipUnstable`, `outputUnreleased`, `tagPrefix`, `firstRelease`) are stripped
before the rest are forwarded to the preset.

```ts
import { createGenerator } from '@repo-toolkit/changelog';

const generator = await createGenerator({ tagPrefix: 'v' });
generator.writeStream().pipe(process.stdout);
```

## `createPreset(options)`

Builds the conventional-commits preset that `createGenerator` loads. Returns the
preset object tagged with `name: 'conventionalcommits'`. Useful when you want
to inspect or reuse the preset independently of the generator.

```ts
import { createPreset } from '@repo-toolkit/changelog';

const preset = await createPreset({ types: [{ type: 'feat', section: 'Features' }] });
```
