import { defineConfig } from 'vitest/config';

// Shared Vitest configuration that every tier composes via `mergeConfig`.
// Per-tier configs add their own `include`, `environment`, `setupFiles`,
// and `testTimeout`.
export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.component.test.tsx',
        'src/test/**/*',
        'src/db/types.ts',
        'src/**/*.d.ts',
        'dist/**',
        '.astro/**',
      ],
    },
  },
});
