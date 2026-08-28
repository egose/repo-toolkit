## [0.21.0](https://github.com/egose/repo-toolkit/compare/v0.20.0...v0.21.0) (2026-08-28)

### Features

* add managed-page pruning and parent summary support ([49d63f4](https://github.com/egose/repo-toolkit/commit/49d63f45ac34169f4dddcebe3d2d9e8a6a8f6d6a))

### Documentation

* record implementation task for managed page pruning ([95d930d](https://github.com/egose/repo-toolkit/commit/95d930da9e9a7af9351eaeab0427a52b5c6d9b1d))

## [0.20.0](https://github.com/egose/repo-toolkit/compare/v0.19.0...v0.20.0) (2026-08-28)

### Features

* add configurable confluence page title strategies ([62d1dcc](https://github.com/egose/repo-toolkit/commit/62d1dcc96815cc553e32f129baccb1e8998cc188))

## [0.19.0](https://github.com/egose/repo-toolkit/compare/v0.18.0...v0.19.0) (2026-08-27)

### Features

* **compose-sandbox:** add docker-compose support to compose sandbox fixtures and CI ([e4f6e5f](https://github.com/egose/repo-toolkit/commit/e4f6e5f25ccbe7e74920cf68e9dc1c861d777878))
* **go-release:** add unified go release cli with build and verify commands ([860adab](https://github.com/egose/repo-toolkit/commit/860adabe6649ed19b60c8a33c9ff37ba9b63c315))
* **release-artifact:** add unified release artifact cli ([bf4884c](https://github.com/egose/repo-toolkit/commit/bf4884c3e9973db1c3fc0df7bdf32df45e2be865))

### Bug Fixes

* **compose-sandbox:** stabilize compose sandbox regression tests under serial execution ([3f4af77](https://github.com/egose/repo-toolkit/commit/3f4af775e81ba4d6fc99f7f2b451514a0ed1436b))

## [0.18.0](https://github.com/egose/repo-toolkit/compare/v0.17.0...v0.18.0) (2026-08-26)

### Features

* expand compose sandbox configuration, lifecycle, and CLI handling ([61d4087](https://github.com/egose/repo-toolkit/commit/61d4087d846a6e3e3a097832b6ea3e16a27a0af0))

## [0.17.0](https://github.com/egose/repo-toolkit/compare/v0.16.0...v0.17.0) (2026-08-26)

### Features

* add compose sandbox runner package and docs ([058b4e9](https://github.com/egose/repo-toolkit/commit/058b4e9f6f189d103cdb73cbbbc14fc3efdd5500))

### Bug Fixes

* **compose-sandbox:** extend compose sandbox test timeout for real compose runs ([39df2a0](https://github.com/egose/repo-toolkit/commit/39df2a0209819ae1183b9e5128fff94bd9220ffa))

## [0.16.0](https://github.com/egose/repo-toolkit/compare/v0.15.0...v0.16.0) (2026-08-25)

### Features

* **confluence:** add folder-aware repository notice URLs ([daa23f9](https://github.com/egose/repo-toolkit/commit/daa23f9776a7c87ee584bbbbdb3af5a768984b6d))

## [0.15.0](https://github.com/egose/repo-toolkit/compare/v0.14.2...v0.15.0) (2026-08-25)

### Features

* **confluence:** add repository source notice and table rendering support ([0fe4801](https://github.com/egose/repo-toolkit/commit/0fe4801b830a42070c075a6d10c60c0d9b1d634d))

## [0.14.2](https://github.com/egose/repo-toolkit/compare/v0.14.1...v0.14.2) (2026-08-25)

### Bug Fixes

* **confluence:** preserve large JSON responses and truncate invalid payload previews ([3b8e2ed](https://github.com/egose/repo-toolkit/commit/3b8e2ed58380b86f03a9dc3cba8a778de9868fa4))

## [0.14.1](https://github.com/egose/repo-toolkit/compare/v0.14.0...v0.14.1) (2026-08-25)

### Bug Fixes

* **confluence:** include response body in API errors and use space pages endpoint ([8dd2369](https://github.com/egose/repo-toolkit/commit/8dd2369cec7189de0f4b21e2bbbee18e92c85062))

## [0.14.0](https://github.com/egose/repo-toolkit/compare/v0.12.2...v0.14.0) (2026-08-24)

### Features

* add archive member limit override to release artifact validation ([19e7182](https://github.com/egose/repo-toolkit/commit/19e718290ee101b7911e954f1a0e9555dcca182d))
* add deterministic Go release package and workspace integration ([ba8feaf](https://github.com/egose/repo-toolkit/commit/ba8feaf22feb0dedb4b7a939d1b62a3f84a5ac8f))

### Bug Fixes

* **go-release:** accept flexible documented example fences ([294e018](https://github.com/egose/repo-toolkit/commit/294e018d44af78388b311497303fc53a14e94f58))

## [0.12.2](https://github.com/egose/repo-toolkit/compare/v0.12.1...v0.12.2) (2026-08-15)

## [0.12.1](https://github.com/egose/repo-toolkit/compare/v0.12.0...v0.12.1) (2026-08-15)

### Bug Fixes

* **publish-package:** ignore passthrough separator while parsing flags ([ac4312a](https://github.com/egose/repo-toolkit/commit/ac4312a1e72c118592c97cf3083aaf2955fdabc2))

## [0.12.0](https://github.com/egose/repo-toolkit/compare/v0.11.0...v0.12.0) (2026-08-15)

### Features

* **release-artifact:** support arbitrary workspace scopes in command closure ([ee83f17](https://github.com/egose/repo-toolkit/commit/ee83f17b89ccc10eaae33a18ef3cf701fd253f35))

## [0.11.0](https://github.com/egose/repo-toolkit/compare/v0.10.0...v0.11.0) (2026-08-15)

### Features

* **publish-package:** preserve package metadata fields during publish rewrites ([85e2091](https://github.com/egose/repo-toolkit/commit/85e209171d84e891b87d49c2591bdc13a24110a8))

### Bug Fixes

* **publish-package:** ignore leading script separator before parsing flags ([67ba969](https://github.com/egose/repo-toolkit/commit/67ba9695aa53010ce76fbd480effc77aa47c2637))

## [0.10.0](https://github.com/egose/repo-toolkit/compare/v0.9.0...v0.10.0) (2026-08-11)

### Features

* add typed gateway support for custom Confluence sync clients ([f3ffec2](https://github.com/egose/repo-toolkit/commit/f3ffec2229ad70c8ac35fbad33d0e2984389a5cc))
* **changelog:** harden changelog config validation and default types ([59f1d71](https://github.com/egose/repo-toolkit/commit/59f1d71439230e067106a752399b5f1144675dee))
* extend publish package helpers and publish-packages CLI contracts ([18c2693](https://github.com/egose/repo-toolkit/commit/18c2693a7489931671615518f482fb003557557d))
* harden release artifact execution and validation ([a2fb6e2](https://github.com/egose/repo-toolkit/commit/a2fb6e22897837ea50db0decefc8f1508441a74f))
* harden release artifact installation with atomic shared verification ([2469c93](https://github.com/egose/repo-toolkit/commit/2469c9364922d3449c04be1e55356a581d99d8d6))
* harden release artifacts, changelog generation, and confluence sync ([1cb2867](https://github.com/egose/repo-toolkit/commit/1cb2867b3f1b9f4c16005792931f003564f771e4))
* stream multipart uploads and bound render and sync operations ([c45bfc7](https://github.com/egose/repo-toolkit/commit/c45bfc7ac2ca061db41297e732d796f4bd48fbb9))

### Documentation

* **changelog:** expand changelog CLI and API documentation ([75108ae](https://github.com/egose/repo-toolkit/commit/75108ae8e7d606bc568f7bec895201cf3c8349c5))
* **publish-package:** document public helpers and runner contract ([4fcdd6f](https://github.com/egose/repo-toolkit/commit/4fcdd6fee30108f8351b923da871247f7221d953))
* update release artifact usage guidance ([b11ad57](https://github.com/egose/repo-toolkit/commit/b11ad57da9d69badd8c2a188c632e5e456b783b2))

### Code Refactoring

* **publish-package:** split package internals into focused modules ([9fd85ec](https://github.com/egose/repo-toolkit/commit/9fd85ec385edbb69359d2fda639d563dcd8c0554))

## [0.9.0](https://github.com/egose/repo-toolkit/compare/v0.8.0...v0.9.0) (2026-08-02)

### Features

* **confluence:** add html fenced block rendering support ([3c284f8](https://github.com/egose/repo-toolkit/commit/3c284f8130f67c924fec80407523336da0a01a58))
* **confluence:** add mermaid block rendering for confluence sync ([83b289f](https://github.com/egose/repo-toolkit/commit/83b289f57cc577cdf47b6f709204833ba4e204d3))
* **confluence:** strip frontmatter before converting markdown ([f899665](https://github.com/egose/repo-toolkit/commit/f89966562f4ed70f15cf4093a3f0263ba2f656f7))

## [0.8.0](https://github.com/egose/repo-toolkit/compare/v0.7.2...v0.8.0) (2026-08-01)

### Features

* add confluence docs sync package ([4e480d1](https://github.com/egose/repo-toolkit/commit/4e480d16d74941c4e80653c5d24d30e54d46b094))
* add interactive prompts to publish and release CLIs ([8390b80](https://github.com/egose/repo-toolkit/commit/8390b8090fdd71f5101198f9347247fb5bb77e3f))

### Bug Fixes

* **confluence:** allow dry-run syncs without credentials ([3661063](https://github.com/egose/repo-toolkit/commit/3661063172d0b846ffde4d67b738313b1d39cd00))

## [0.7.2](https://github.com/egose/repo-toolkit/compare/v0.7.1...v0.7.2) (2026-07-13)

### Bug Fixes

* **release-artifact:** anchor leading-slash glob patterns to the copy root ([6d40eb0](https://github.com/egose/repo-toolkit/commit/6d40eb09c15d2b6fef0add8db4986c0dcce7887a))

## [0.7.1](https://github.com/egose/repo-toolkit/compare/v0.7.0...v0.7.1) (2026-07-12)

## [0.7.0](https://github.com/egose/repo-toolkit/compare/v0.6.0...v0.7.0) (2026-07-11)

### Features

* add release artifact package and streamline CLI parsing ([4fb0b59](https://github.com/egose/repo-toolkit/commit/4fb0b597b21bab7edc13e77411d825bcefab71d2))
* expand changelog build filter for workspace dependencies ([412d5db](https://github.com/egose/repo-toolkit/commit/412d5dbc66a69e56e372b95ad1fe472874b929f4))

### Documentation

* update repository metadata urls ([90adfb6](https://github.com/egose/repo-toolkit/commit/90adfb6e23549fe051bdd619ff49a70dc41e0a3c))
* update unreleased changelog entries ([7ecc13d](https://github.com/egose/repo-toolkit/commit/7ecc13dbf6d2344a5a28ff770053a3b19aeeb767))

## [0.6.0](https://github.com/egose/repo-toolkit/compare/v0.5.0...v0.6.0) (2026-07-10)

### Features

* enable committing pre-commit fixes on push ([18da7a4](https://github.com/egose/repo-toolkit/commit/18da7a4aab4b6a1fdc8d58a8d57f1e971427b022))

### Bug Fixes

* make installer executable ([50db5eb](https://github.com/egose/repo-toolkit/commit/50db5eb3709b0438c7b5f9e673d544bf2a2270e5))
* preserve symlinks in release artifacts and verify them ([aacb037](https://github.com/egose/repo-toolkit/commit/aacb037aa1c973f6ad139c2bc49e90e20f42d87d))

## [0.5.0](https://github.com/egose/repo-toolkit/compare/v0.4.1...v0.5.0) (2026-07-09)

### Features

* add asdf plugin configuration ([8c2eee2](https://github.com/egose/repo-toolkit/commit/8c2eee2a2e3606432f87bc8e536e341c205c8567))
* filter published releases in version listing and downloads ([69c6afb](https://github.com/egose/repo-toolkit/commit/69c6afb569ff82e7d635b2dd91a511828d36261d))

## [0.4.1](https://github.com/egose/repo-toolkit/compare/v0.4.0...v0.4.1) (2026-07-08)

### Bug Fixes

* include package dependencies in publish scripts ([a7a755a](https://github.com/egose/repo-toolkit/commit/a7a755a998ecaa18285443f792092d1692628aca))

## [0.4.0](https://github.com/egose/repo-toolkit/compare/v0.3.0...v0.4.0) (2026-07-08)

### Features

* extend publish file selection and config loading ([5377738](https://github.com/egose/repo-toolkit/commit/5377738f9b5267304a2de7a87f73994ca6ebf195))

## [0.3.0](https://github.com/egose/repo-toolkit/compare/v0.2.0...v0.3.0) (2026-07-08)

### Features

* split publish tooling into single-package and monorepo commands ([c5ce5db](https://github.com/egose/repo-toolkit/commit/c5ce5dbd82c20f9d56a1f421dba926ceafedddc3))

## [0.2.0](https://github.com/egose/repo-toolkit/compare/v0.1.0...v0.2.0) (2026-07-08)

### Features

* **publish-all:** rewrite bin paths in published package json ([821b41d](https://github.com/egose/repo-toolkit/commit/821b41db936c9c7aa0b7a1ec07daf7df40a0f107))

## [0.1.0](https://github.com/egose/repo-toolkit/compare/v0.0.1...v0.1.0) (2026-07-08)

### Features

* allow custom publish directory and version placeholder ([ce9a3ba](https://github.com/egose/repo-toolkit/commit/ce9a3ba6c079e40c86a7fd90979d57ab25e84a21))

## [0.0.1](https://github.com/egose/repo-toolkit/compare/6dda93905e62783e559668e7ed4b5f8fe0caed8f...v0.0.1) (2026-07-08)

### Features

* add website docs, workflows, and changelog defaults ([6dda939](https://github.com/egose/repo-toolkit/commit/6dda93905e62783e559668e7ed4b5f8fe0caed8f))

### Documentation

* add Apache 2.0 license ([4323a1d](https://github.com/egose/repo-toolkit/commit/4323a1d9bf44afaeae8510b99383c2d3299ef2a6))
* update repository README with workspace layout and release flow ([3a77b11](https://github.com/egose/repo-toolkit/commit/3a77b11208f2e595eae3afac314df2aaa4cd8fae))
