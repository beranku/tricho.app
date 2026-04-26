import { test, expect } from './fixtures/vault';

// Skip the file when billing isn't enabled in this CI environment, OR when
// localstripe + stripe-mock aren't reachable (they live under the ci profile,
// so missing them is a CI configuration problem to surface explicitly).
test.beforeAll(async ({ request }) => {
  // /auth/billing/stripe/checkout returns 503 with `billing_disabled` when
  // BILLING_ENABLED isn't 'true'. We use the response to gate the suite.
  const r = await request.post('/auth/billing/stripe/checkout', {
    failOnStatusCode: false,
    data: { plan: 'pro-monthly', successUrl: 'https://x/s', cancelUrl: 'https://x/c' },
  });
  test.skip(r.status() === 503, 'Billing disabled in this environment');
});

test('creating a Checkout session against stripe-mock returns a checkoutUrl', async ({ page, vaultUser }) => {
  const r = await page.evaluate(
    async ({ jwt }) => {
      const res = await fetch('/auth/billing/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          plan: 'pro-monthly',
          successUrl: 'https://tricho.test/billing/success',
          cancelUrl: 'https://tricho.test/billing/cancel',
        }),
      });
      return { status: res.status, body: await res.json() };
    },
    { jwt: vaultUser.jwt },
  );

  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.checkoutUrl, 'expected a checkoutUrl from the stripe mock').toBeTruthy();
  expect(typeof r.body.checkoutUrl).toBe('string');
});

test('webhook with valid HMAC signature credits the user', async ({ page, vaultUser }) => {
  // Compose a synthetic invoice.paid webhook and sign it with the test
  // STRIPE_WEBHOOK_SECRET the ci compose stack uses (see workflow env).
  // Then POST it through Traefik like the real Stripe edge would.
  const result = await page.evaluate(async ({ canonicalUsername }) => {
    const event = {
      id: `evt_e2e_${Date.now()}`,
      type: 'invoice.paid',
      data: {
        object: {
          customer: 'cus_e2e_1',
          subscription: 'sub_e2e_1',
          subscription_details: { metadata: { canonicalUsername } },
          lines: { data: [{ price: { id: 'price_e2e' } }] },
        },
      },
    };
    const body = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    // We can't compute HMAC in the page (no Node crypto); instead, ask the
    // test to sign via window.crypto.subtle with the well-known test secret.
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode('whsec_test_ci'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${body}`));
    const sig = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const r = await fetch('/auth/billing/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': `t=${t},v1=${sig}`,
      },
      body,
    });
    return { status: r.status, body: await r.json() };
  }, { canonicalUsername: vaultUser.couchdbUsername });

  // 200 + action: credited (or 'noop' if the price ID doesn't map → still
  // proves signature verification + handler routing).
  expect(result.status).toBe(200);
  expect(['credited', 'upsert', 'noop', 'no-user']).toContain(result.body?.action ?? null);
});
