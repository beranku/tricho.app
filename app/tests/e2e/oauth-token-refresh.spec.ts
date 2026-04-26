import { test, expect } from './fixtures/vault';

// Verifies that a refresh-token swap produces a fresh JWT with a later `exp`
// claim than the original. This exercises the same /auth/refresh endpoint
// the in-browser client-side OIDC plumbing in src/auth/oauth.ts uses.
//
// We do not need to wait for a real id_token to expire to assert the
// refresh path works — that just verifies wall-clock arithmetic. Asserting
// the `exp` claim moves forward across a refresh is what matters.

function decodeJwtPayload(jwt: string): { exp: number } {
  const [, payloadB64] = jwt.split('.');
  const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json);
}

test('refresh token rotates the JWT with a new (later) exp claim', async ({ page, vaultUser }) => {
  const before = decodeJwtPayload(vaultUser.jwt);

  // Find the deviceId cookie set on the OAuth callback.
  const cookies = await page.context().cookies();
  const deviceCookie = cookies.find((c) => c.name === 'tricho_device');
  expect(deviceCookie, 'tricho_device cookie should be set').toBeDefined();

  // Sleep 1.1 s so the new token's iat is at least 1 s newer.
  await page.waitForTimeout(1100);

  const refreshed = await page.evaluate(
    async ({ refreshToken, deviceId }) => {
      const r = await fetch('/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken, deviceId }),
      });
      return { status: r.status, body: await r.json() };
    },
    { refreshToken: vaultUser.refreshToken, deviceId: deviceCookie!.value },
  );

  expect(refreshed.status).toBe(200);
  expect(refreshed.body.tokens?.jwt).toBeTruthy();

  const after = decodeJwtPayload(refreshed.body.tokens.jwt);
  expect(after.exp).toBeGreaterThan(before.exp);

  // The newly minted JWT must work on /auth/devices.
  const auth = await page.evaluate(async (jwt) => {
    const res = await fetch('/auth/devices', { headers: { authorization: `Bearer ${jwt}` } });
    return res.status;
  }, refreshed.body.tokens.jwt);
  expect(auth).toBe(200);
});

test('using a revoked (already-rotated) refresh token returns 401', async ({ page, vaultUser }) => {
  const cookies = await page.context().cookies();
  const deviceCookie = cookies.find((c) => c.name === 'tricho_device');

  // Rotate once.
  const ok = await page.evaluate(
    async ({ refreshToken, deviceId }) => {
      const r = await fetch('/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken, deviceId }),
      });
      return r.ok;
    },
    { refreshToken: vaultUser.refreshToken, deviceId: deviceCookie!.value },
  );
  expect(ok).toBe(true);

  // The original refreshToken is now revoked — second use must 401.
  const replay = await page.evaluate(
    async ({ refreshToken, deviceId }) => {
      const r = await fetch('/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken, deviceId }),
      });
      return { status: r.status, body: await r.json() };
    },
    { refreshToken: vaultUser.refreshToken, deviceId: deviceCookie!.value },
  );
  expect(replay.status).toBe(401);
  expect(replay.body.error).toBe('invalid_refresh_token');
});
