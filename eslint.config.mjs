// @ts-check
/**
 * ESLint flat config for the whole workspace.
 *
 * Deliberately *not* type-aware (`typescript-eslint/configs/recommended`
 * rather than `recommendedTypeChecked`): type-aware rules need every file to
 * belong to a tsconfig, and the root-level `scripts/` directory deliberately
 * has none - it is run by `tsx`, not compiled. A lint run that fails with
 * "file not found in project" teaches people to ignore lint output, which is
 * worse than running fewer rules. Type errors are caught by
 * `npm run typecheck`, which covers every workspace with strict settings.
 */

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.d.ts',
      'data/**',
      'eslint.config.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // JSX lives under `parserOptions`: `languageOptions.ecmaFeatures` was
      // removed from the flat-config schema in ESLint 10.
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Unused parameters are a real signal in production code, but the
      // recording context stubs in tests take a parameter purely to keep the
      // call signature honest. Leading underscore opts out explicitly rather
      // than disabling the rule wholesale.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // `any` gets through now and then at JSON boundaries; making it an
      // error drives it to be silenced with `eslint-disable`, which hides the
      // real offenders too. Warn keeps it visible without blocking `lint`.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // Console output belongs to the CLIs, not the app.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // The seed/backup/restore/smoke CLIs exist to print, and the smoke script
  // walks arbitrary HTTP payloads where `unknown` would mean a cast on every
  // single line.
  {
    files: ['server/src/scripts/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Tests assert on scratch values and print diagnostics on failure.
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
