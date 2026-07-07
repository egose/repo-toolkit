# `_repo-toolkit`

Shared monorepo for repository-level tooling.

## Packages

- `@repo-toolkit/changelog`: shared conventional changelog preset, generator, and CLI

## Development

```sh
pnpm install
pnpm build
```

## Root Release Flow

The workspace root keeps its own `release-it` setup and uses `@repo-toolkit/changelog`
to generate the root `CHANGELOG.md`.
