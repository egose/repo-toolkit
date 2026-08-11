# Action smoke fixture for @repo-toolkit/confluence

#

# This directory is NOT shipped in the npm tarball (the package `files` field

# only includes `README.md` and `dist`). It exists so an Action bundler or CI

# job can prove the CLI entrypoint wires INPUT\_\* env to a real sync start with

# no network and no secret echo.

#

# Run locally after building the package:

#

# node packages/confluence/action-fixture/smoke.mjs

#

# Expected output: PASS on stderr (exit 0). The fixture:

# 1. creates a tiny docs folder under a temp dir

# 2. spawns dist/cli.js with INPUT\_\* env and INPUT_DRY-RUN=true

# 3. asserts the CLI emits [dry-run] lines for both markdown files

# (i.e. it read INPUT\_\* and started the sync pipeline)

# 4. asserts the supplied INPUT_API-TOKEN never appears on stdout or stderr

# 5. cleans up the temp dir

#

# In a bundled action, point `runs.main` at the bundled copy of `dist/cli.js`

# (or the ncc bundle that ships src/cli.ts). The smoke fixture spawns the

# unbundled dist/cli.js to stay repo- and test-runnable.
