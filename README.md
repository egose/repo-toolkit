# `repo-toolkit`

Shared monorepo for repository tooling packages.

## Packages

- `@repo-toolkit/changelog`: shared conventional changelog preset, generator, and CLI for repository releases
- `@repo-toolkit/publish-package`: build, stage, and publish a single package to npm
- `@repo-toolkit/publish-packages`: build, stage, and publish every package in a monorepo to npm in dependency order
- `@repo-toolkit/release-artifact`: assemble, verify, and distribute a self-contained CLI release artifact (tarball) from a monorepo
- `@repo-toolkit/compose-sandbox`: run a repository-defined Docker Compose test sandbox through a deterministic lifecycle
- `@repo-toolkit/confluence`: sync a folder of markdown docs to Confluence pages and attachments (GitHub Action compatible)
- `@repo-toolkit/go-release`: build and verify deterministic cross-platform Go binary releases

## Workspace Layout

- `packages/changelog`: changelog preset, JavaScript API, and `repo-toolkit-changelog` CLI
- `packages/publish-package`: single-package publish pipeline and `repo-toolkit-publish-package` CLI
- `packages/publish-packages`: monorepo publish pipeline and `repo-toolkit-publish-packages` CLI
- `packages/release-artifact`: release artifact builder/verifier and `repo-toolkit-release-artifact` / `repo-toolkit-build-artifact` / `repo-toolkit-verify-artifact` CLIs
- `packages/compose-sandbox`: Docker Compose sandbox runner and `repo-toolkit-compose-sandbox` CLI
- `packages/confluence`: docs-as-code sync to Confluence and `repo-toolkit-confluence` CLI
- `packages/go-release`: Go release builder/verifier and `repo-toolkit-go-release` / `repo-toolkit-build-go-release` / `repo-toolkit-verify-go-release` CLIs
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
- `pnpm build-artifact -- --version v1.2.3`
- `pnpm verify-artifact -- --version v1.2.3`
- `pnpm release-artifact -- build --version v1.2.3`
- `pnpm release-artifact -- verify --version v1.2.3`
- `pnpm release-artifact -- install --archive-path ./dist/repo-toolkit-v1.2.3.tar.gz --install-path /tmp/install --version v1.2.3`
- `pnpm build-go-release -- --config go-release.json --version 1.2.3`
- `pnpm verify-go-release -- --config go-release.json --version 1.2.3`
- `pnpm go-release -- build --config go-release.json --version 1.2.3`
- `pnpm go-release -- verify --config go-release.json --version 1.2.3 --reproducibility`
- `pnpm confluence -- --folder docs --space-key ENG --parent-page-id 123456789`
- `pnpm release`

## asdf Plugin

Use this repository directly as an asdf plugin:

```sh
asdf plugin add repo-toolkit https://github.com/egose/repo-toolkit.git
asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git
asdf install nodejs <node-version>
asdf install repo-toolkit <repo-toolkit-version>
asdf global repo-toolkit <repo-toolkit-version>
```

Available commands after install:

- `repo-toolkit-changelog`
- `repo-toolkit-publish-package`
- `repo-toolkit-publish-packages`
- `repo-toolkit-release-artifact` (`build`/`verify`/`install` subcommands, aliases `repo-toolkit-build-artifact` / `repo-toolkit-verify-artifact` / `repo-toolkit-install-artifact` remain available)
- `repo-toolkit-build-artifact`
- `repo-toolkit-verify-artifact`
- `repo-toolkit-install-artifact`
- `repo-toolkit-confluence`
- `repo-toolkit-go-release` (`build`/`verify` subcommands, aliases `repo-toolkit-build-go-release` / `repo-toolkit-verify-go-release` remain available)
- `repo-toolkit-build-go-release`
- `repo-toolkit-verify-go-release`

Useful asdf commands:

- `asdf list all repo-toolkit` (shows only versions with published install archives)
- `asdf install repo-toolkit latest`
- `asdf local repo-toolkit <repo-toolkit-version>`

`repo-toolkit` runs on Node.js, so install a compatible `nodejs` version in asdf before invoking the commands.

The release artifact discovers workspace packages from `packages/*` and automatically exposes any package with a `bin` entry.

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
