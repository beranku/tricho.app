// ESLint flat config. Tightly scoped: catch the kind of bug that produced
// the post-wizard black screen (a useCallback declared after view-based
// early returns, which violates the Rules of Hooks and crashes the React
// tree). Not a full lint pass — TypeScript via `tsc --noEmit` already
// covers most type/structure issues, and we don't want a noisy migration.
//
// Run via `npm run lint`. CI wires this into the test-app job.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', '.astro/**', 'src/paraglide/**', 'node_modules/**'],
  },
  ...tseslint.configs.recommended.map((c) => ({
    ...c,
    files: ['src/**/*.{ts,tsx}'],
  })),
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // The headline rule. Calling hooks conditionally (after an `if (...)
      // return`, inside a loop, etc.) means React sees a different hook
      // count between renders and throws #310. That crash unmounts the
      // tree — visible as a blank/black screen in production builds.
      // Hard error.
      'react-hooks/rules-of-hooks': 'error',
      // Useful but flags a lot of pre-existing patterns; demote to warn so
      // it shows up but doesn't gate CI. Tighten to error in a follow-up
      // pass once existing call sites are clean.
      'react-hooks/exhaustive-deps': 'warn',
      // typescript-eslint's `no-unused-vars` is more accurate than the
      // base ESLint one for TS code.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Keep the rest of the recommended typescript-eslint rules at
      // warn so they don't gate CI on existing code; they still surface.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
    },
  },
  {
    // Test files: relax further. Vitest wraps a lot of mocking patterns
    // that trip recommended rules without value.
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
];
