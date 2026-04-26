// Boot-time guards for the third-party-integration env vars.
//
// In production, refuse to start if any of GOOGLE_ISSUER_URL,
// APPLE_OIDC_ISSUER, or STRIPE_API_BASE points at a known test/mock host.
// Catches the "I copied .env.ci into prod" misconfiguration class. Test
// hostnames are matched on word boundaries so production hostnames such as
// `tricho.app` (note the .app TLD, not .test) do not trip the guard.

const MOCK_HOST_RE =
  /\b(localhost|127\.0\.0\.1|mock-oidc|stripe-mock|localstripe|tricho\.test)\b/i;

const GUARDED_VARS = ['GOOGLE_ISSUER_URL', 'APPLE_OIDC_ISSUER', 'STRIPE_API_BASE'];

export function assertProdIntegrationsAreReal(env) {
  if (env.NODE_ENV !== 'production') return;
  for (const name of GUARDED_VARS) {
    const value = env[name];
    if (value && MOCK_HOST_RE.test(value)) {
      const msg = `${name} points at a mock host (${value}) but NODE_ENV=production`;
      throw new Error(msg);
    }
  }
}
