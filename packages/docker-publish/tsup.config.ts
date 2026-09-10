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
      cli: 'src/cli.ts',
      'cli-build': 'src/cli-build.ts',
      'cli-publish': 'src/cli-publish.ts',
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
]);
