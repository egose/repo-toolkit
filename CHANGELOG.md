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
