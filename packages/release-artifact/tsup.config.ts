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
