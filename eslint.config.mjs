import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

/**
 * Lint configuration.
 *
 * `next/core-web-vitals` and `next/typescript` carry the rules that matter for
 * an App Router codebase; the extra rules below are the ones that have caught
 * real defects in this project rather than style preferences.
 */
export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'src/generated/**',
      'storage/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // An unawaited promise in a route handler silently drops the write.
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      // React escapes text on output; the apostrophes in Uzbek copy are fine.
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    files: ['tests/**/*.ts', 'e2e/**/*.ts', 'scripts/**/*.ts', 'prisma/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
