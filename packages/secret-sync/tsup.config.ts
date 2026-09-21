import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    target: 'node20',
    outDir: 'dist',
    clean: true,
    external: ['@1password/sdk', '@1password/sdk-core', '@clack/prompts'],
  },
  {
    entry: {
      cli: 'src/cli.ts',
    },
    format: ['esm'],
    dts: false,
    target: 'node20',
    outDir: 'dist',
    clean: false,
    external: ['@1password/sdk', '@1password/sdk-core', '@clack/prompts'],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
