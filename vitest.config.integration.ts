import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.base';

// Backend integration tier — testcontainers-backed CouchDB. Each file spins
// its own container so parallelism is safe. Per-test budget: < 2 s (plus
// the ~3-5 s container startup amortised across the file's tests).
export default mergeConfig(
  base,
  defineConfig({
    test: {
      environment: 'node',
      include: ['infrastructure/**/test/integration/**/*.integration.test.mjs'],
      passWithNoTests: true,
      testTimeout: 60_000,
      hookTimeout: 60_000,
      coverage: { enabled: false },
    },
  }),
);
