import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  {
    ignores: ['website/**'],
  },
  {
    // The pre-rewrite docs-as-code-confluence action lives here for reference;
    // the rewrite is the `@repo-toolkit/confluence` package under packages/.
    ignores: ['.docs-as-code-confluence/**'],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      sourceType: 'module',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
