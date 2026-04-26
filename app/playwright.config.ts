import { defineConfig, devices } from '@playwright/test';

// Tests run against the ci profile's Traefik edge at https://tricho.test.
// The `make e2e` target brings the stack up first; tests assume it's ready.
//
// `ignoreHTTPSErrors` covers the committed self-signed cert under
// infrastructure/traefik/ci-certs/ — see that dir's README for why that's
// not a secret.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://tricho.test',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // tricho.test is an RFC 6761 reserved TLD that never resolves — map it
    // to the local host via Chromium's DNS-override flag. CI adds the same
    // mapping via /etc/hosts; this keeps local `npx playwright test` viable
    // without system changes.
    launchOptions: {
      args: ['--host-resolver-rules=MAP tricho.test 127.0.0.1'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: devices['Desktop Chrome'],
    },
  ],
});
