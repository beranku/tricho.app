import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.base';

// Backend unit tier — tricho-auth + mock-oidc modules under their own
// test/ subdirs. Pure Node environment, no docker. Median: < 20 ms.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      environment: 'node',
      include: ['../infrastructure/**/test/**/*.test.mjs'],
      exclude: ['../infrastructure/**/test/integration/**'],
      passWithNoTests: true,
      coverage: {
        include: ['../infrastructure/**/*.mjs'],
        exclude: ['../infrastructure/**/test/**', '../infrastructure/**/node_modules/**'],
        reportsDirectory: 'coverage/backend',
      },
    },
  }),
);
