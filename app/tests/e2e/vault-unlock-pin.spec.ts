import { test } from '@playwright/test';

// TODO (tracked follow-up): Create-vault-with-PIN → reload → unlock-with-PIN
// is a multi-step UI flow that requires:
//   - a way to bypass the WebAuthn registration step (the PRF path is
//     physically unavailable inside headless Chromium without a virtual
//     authenticator), OR
//   - a test-only build flag exposing a "create PIN vault" UI affordance
//     that bypasses the passkey step
// Neither is in the repo today. Keeping the spec as a TODO placeholder
// so the CI job exercises the shape, and so the spec file exists.

test.skip('create vault with PIN → reload → unlock with PIN', async () => {});
test.skip('wrong PIN increments lockout counter', async () => {});
test.skip('lockout threshold disables the input', async () => {});
