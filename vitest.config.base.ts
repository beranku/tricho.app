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
      // `include` is intentionally empty at the base level because
      // mergeConfig concatenates arrays — any base include would leak
      // into every tier's scope. Each tier declares its own include.
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
