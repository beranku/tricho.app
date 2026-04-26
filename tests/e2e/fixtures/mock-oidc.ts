import type { Page } from '@playwright/test';

export interface GoogleIdentity {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string | null;
}

export interface AppleIdentity {
  sub: string;
  email?: string;
  email_verified?: boolean;
  is_private_email?: boolean;
  name?: { firstName: string; lastName: string } | null;
}

async function postIdentity(page: Page, path: string, body: unknown): Promise<void> {
  await page.goto('/');
  const result = await page.evaluate(async ({ p, b }) => {
    const res = await fetch(p, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    });
    return { ok: res.ok, status: res.status };
  }, { p: path, b: body });
  if (!result.ok) throw new Error(`POST ${path} failed with status ${result.status}`);
}

/** Seed the Google tenant identity for the next /authorize. */
export async function setMockGoogleIdentity(page: Page, identity: GoogleIdentity): Promise<void> {
  await postIdentity(page, '/mock-oidc/google/mock/identity', { email_verified: true, ...identity });
}

/** Seed the Apple tenant identity for the next /authorize. */
export async function setMockAppleIdentity(page: Page, identity: AppleIdentity): Promise<void> {
  await postIdentity(page, '/mock-oidc/apple/mock/identity', { email_verified: true, ...identity });
}

/** Reset the Apple tenant's per-sub "first-time" state. Pass `{sub}` to clear
 *  one specific sub, or omit to clear all. */
export async function resetMockApple(page: Page, body: { sub?: string } = {}): Promise<void> {
  await postIdentity(page, '/mock-oidc/apple/mock/reset', body);
}

/**
 * @deprecated Use `setMockGoogleIdentity` instead. Kept as a backwards-compatible
 * alias so existing specs keep working until the next change moves them.
 */
export async function setMockIdentity(page: Page, identity: GoogleIdentity): Promise<void> {
  return setMockGoogleIdentity(page, identity);
}
