import type { Page } from '@playwright/test';

/**
 * Seed the mock-oidc container with the identity the next authorize will
 * return. Fire this before any `/auth/google/start` navigation.
 */
export async function setMockIdentity(
  page: Page,
  identity: {
    sub: string;
    email: string;
    email_verified?: boolean;
    name?: string;
    picture?: string | null;
  },
): Promise<void> {
  await page.goto('/');
  const result = await page.evaluate(async (id) => {
    const res = await fetch('/mock-oidc/mock/identity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email_verified: true, ...id }),
    });
    return { ok: res.ok, status: res.status };
  }, identity);
  if (!result.ok) {
    throw new Error(`setMockIdentity failed with status ${result.status}`);
  }
}
