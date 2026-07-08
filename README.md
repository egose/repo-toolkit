# `repo-toolkit`

Shared monorepo for repository tooling packages.

## Packages

- `@repo-toolkit/changelog`: shared conventional changelog preset, generator, and CLI for repository releases
- `@repo-toolkit/publish-package`: build, stage, and publish a single package to npm
- `@repo-toolkit/publish-packages`: build, stage, and publish every package in a monorepo to npm in dependency order

## Workspace Layout

- `packages/changelog`: changelog preset, JavaScript API, and `repo-toolkit-changelog` CLI
- `packages/publish-package`: single-package publish pipeline and `repo-toolkit-publish-package` CLI
- `packages/publish-packages`: monorepo publish pipeline and `repo-toolkit-publish-packages` CLI
- `website/`: standalone Docusaurus docs site for the workspace packages

## Development

Install and work from the repository root:

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

Useful root scripts:

- `pnpm lint`
- `pnpm lint-fix`
- `pnpm build`
- `pnpm test`
- `pnpm changelog`
- `pnpm publish-package -- --version v1.2.3`
- `pnpm publish-packages -- --version v1.2.3`
- `pnpm release`

## Documentation Site

The package docs live in `website/`.

`website/` is intentionally kept as a standalone pnpm project, so install and run it separately:

```sh
cd website
pnpm install
pnpm start
```

## Release Flow

The workspace root keeps its own `release-it` setup.

- `pnpm changelog` builds `@repo-toolkit/changelog` and generates the root `CHANGELOG.md`
- `pnpm release` runs `release-it` using `.release-it.json`
- the publish workflow publishes package artifacts from git tags via `pnpm publish-packages -- --version <tag>`

## Package Docs

Each package keeps a concise local `README.md` and the longer guides live in the Docusaurus site under `website/docs/packages/`.
