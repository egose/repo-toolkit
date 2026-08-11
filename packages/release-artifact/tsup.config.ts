import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    target: 'node20',
    outDir: 'dist',
    clean: true,
  },
  {
    entry: {
      'cli-build': 'src/cli-build.ts',
      'cli-verify': 'src/cli-verify.ts',
      'cli-install': 'src/cli-install.ts',
    },
    format: ['esm'],
    dts: false,
    target: 'node20',
    outDir: 'dist',
    clean: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  {
    entry: {
      'cli-install-embedded': 'src/cli-install-embedded.ts',
    },
    format: ['esm'],
    dts: false,
    target: 'node20',
    outDir: 'dist',
    clean: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
    // Inline every runtime dependency (including @repo-toolkit/publish-package/helpers)
    // so this entry can be embedded verbatim into bin/install and run without
    // node_modules on the host. There are no external runtime deps left now that
    // index.ts only imports the zero-dep helpers subpath + node builtins.
    noExternal: [/.*/],
    splitting: false,
  },
]);
