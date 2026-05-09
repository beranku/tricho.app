/**
 * Client-side helpers for the OAuth identity flow.
 *
 * The OAuth dance is server-driven: the PWA redirects to /auth/<provider>/start,
 * the provider redirects back to /auth/<provider>/callback, and the server's
 * callback renders HTML that stores the result in sessionStorage + redirects
 * back to the PWA with a hash marker. This module exposes small helpers for
 * kicking off the redirects and reading the result on re-entry.
 */

// Astro 5's envPrefix is `PUBLIC_` (not Vite's default `VITE_`). Client-
// bundled env vars MUST start with PUBLIC_ to be statically replaced at
// build time; anything else resolves to undefined at runtime.
const AUTH_ORIGIN = (import.meta.env.PUBLIC_AUTH_PROXY_URL as string | undefined) ?? 'http://localhost:4545';
// Cross-origin OAuth completion: tricho-auth's callback 302's the user to
// `${APP_ORIGIN}/app/#tricho-auth-complete=<base64url(JSON)>`. The fragment
// crosses origins through the redirect (browser preserves fragments) and
// stays client-side (not sent to servers, not in Referer). We parse it on
// PWA mount and immediately replaceState the hash away.
export const AUTH_COMPLETE_HASH = '#tricho-auth-complete';
const AUTH_COMPLETE_PREFIX = `${AUTH_COMPLETE_HASH}=`;

export type OAuthProvider = 'google' | 'apple';

export interface OAuthDevice {
  id: string;
  name: string;
  addedAt: number;
  lastSeenAt: number;
}

export type PlanId = 'free' | 'pro-monthly' | 'pro-yearly' | 'max-monthly' | 'max-yearly';
export type PaidPlanId = Exclude<PlanId, 'free'>;
export type TierKey = 'free' | 'pro' | 'max';
export type BillingPeriod = 'month' | 'year' | null;
export type BillingProvider = 'stripe' | 'bank-transfer' | null;
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'expired';
export type Entitlement = 'sync' | 'backup';

export interface OAuthSubscription {
  tier: 'free' | 'paid';
  plan: PlanId;
  tierKey: TierKey;
  billingPeriod: BillingPeriod;
  provider: BillingProvider;
  status: SubscriptionStatus;
  entitlements: Entitlement[];
  deviceLimit: number;
  backupRetentionMonths: number;
  gracePeriodSeconds: number;
  gracePeriodEndsAt: number | null;
  freeDeviceGrandfathered: boolean;
  storageLimitMB: number;
  paidUntil: number | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

export function tierOf(planId: PlanId): TierKey {
  if (planId === 'pro-monthly' || planId === 'pro-yearly') return 'pro';
  if (planId === 'max-monthly' || planId === 'max-yearly') return 'max';
  return 'free';
}

export function billingPeriodOf(planId: PlanId): BillingPeriod {
  if (planId === 'pro-monthly' || planId === 'max-monthly') return 'month';
  if (planId === 'pro-yearly' || planId === 'max-yearly') return 'year';
  return null;
}

export const PAID_PLAN_IDS: PaidPlanId[] = ['pro-monthly', 'pro-yearly', 'max-monthly', 'max-yearly'];

export interface OAuthResult {
  ok: boolean;
  isNewUser: boolean;
  deviceApproved: boolean;
  hasRemoteVault: boolean;
  couchdbUsername: string;
  email: string;
  name: string | null;
  picture: string | null;
  provider: OAuthProvider;
  deviceId: string;
  devices: OAuthDevice[];
  subscription: OAuthSubscription | null;
  tokens: {
    jwt: string;
    jwtExp: number;
    refreshToken: string;
    refreshTokenExp: number;
  } | null;
  /** Optional error class set by the auth-proxy callback when OAuth didn't
   *  succeed cleanly. The wizard surfaces a humanised message inline on
   *  Step 2 instead of silently routing back to Step 1. */
  error?: 'provider-cancelled' | 'provider-error' | 'device-blocked';
}

export function getAuthOrigin(): string {
  return AUTH_ORIGIN;
}

export function startProviderLogin(provider: OAuthProvider): void {
  window.location.assign(`${AUTH_ORIGIN}/auth/${provider}/start`);
}

/**
 * Reads the OAuth result the callback redirected back to us with. The
 * result is base64url-encoded JSON in `window.location.hash`, of the form
 * `#tricho-auth-complete=<base64url(JSON)>`. Returns null if no pending
 * OAuth completion is present in the URL. Idempotent: calling it twice
 * after `clearAuthCompleteHash` gives null on the second call.
 */
export function consumePendingOAuthResult(): OAuthResult | null {
  try {
    if (typeof window === 'undefined') return null;
    const hash = window.location.hash;
    if (!hash.startsWith(AUTH_COMPLETE_PREFIX)) return null;
    const encoded = hash.slice(AUTH_COMPLETE_PREFIX.length);
    if (!encoded) return null;
    // base64url → standard base64 → utf-8 string → JSON.
    const standard = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as OAuthResult;
  } catch {
    return null;
  }
}

/**
 * Strip the auth-complete payload from `window.location.hash` once
 * `consumePendingOAuthResult` has read it, so the access token doesn't
 * linger in browser history or page-share dialogs. Matches both the bare
 * `#tricho-auth-complete` flag (legacy) and the fragment-with-payload form.
 */
export function clearAuthCompleteHash(): void {
  if (typeof window === 'undefined') return;
  if (window.location.hash.startsWith(AUTH_COMPLETE_HASH)) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

export async function logout(refreshToken?: string): Promise<void> {
  await fetch(`${AUTH_ORIGIN}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: refreshToken ?? null }),
  }).catch(() => void 0);
}

/**
 * Two-step account deletion. Step 1: confirm — server returns a single-use
 * token. Step 2: delete — server revokes refresh tokens, deletes the
 * per-user CouchDB account, deletes the subscription doc.
 *
 * Both calls require a JWT with `iat` within the last 5 minutes; older
 * JWTs are rejected with 401 `stale_jwt`. Idempotent on the server side.
 */
export interface DeleteAccountResult {
  ok: boolean;
  reason?: 'stale_jwt' | 'not_found' | 'server_error';
}

export async function deleteAccount(jwt: string): Promise<DeleteAccountResult> {
  try {
    const confirm = await fetch(`${AUTH_ORIGIN}/auth/account/delete-confirm`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
    });
    if (confirm.status === 401) return { ok: false, reason: 'stale_jwt' };
    if (!confirm.ok) return { ok: false, reason: 'server_error' };
    const { token } = (await confirm.json()) as { token: string };
    const del = await fetch(`${AUTH_ORIGIN}/auth/account/delete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (del.status === 401) return { ok: false, reason: 'stale_jwt' };
    if (!del.ok) return { ok: false, reason: 'server_error' };
    return { ok: true };
  } catch (err) {
    console.error('[oauth.deleteAccount] failed', err);
    return { ok: false, reason: 'server_error' };
  }
}

export async function refreshTokens(refreshToken: string, deviceId: string): Promise<{
  jwt: string;
  jwtExp: number;
  refreshToken: string;
  refreshTokenExp: number;
} | null> {
  const res = await fetch(`${AUTH_ORIGIN}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken, deviceId }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json();
}

export interface DeviceListEntry {
  id: string;
  name: string;
  addedAt: number;
  lastSeenAt: number;
}

export interface DeviceListResponse {
  devices: DeviceListEntry[];
  subscription: OAuthSubscription | null;
}

export async function fetchDevices(jwt: string): Promise<DeviceListResponse | null> {
  const res = await fetch(`${AUTH_ORIGIN}/auth/devices`, {
    headers: { authorization: `Bearer ${jwt}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json();
}

export async function revokeDevice(jwt: string, deviceId: string): Promise<boolean> {
  const res = await fetch(`${AUTH_ORIGIN}/auth/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${jwt}` },
  }).catch(() => null);
  return Boolean(res && res.ok);
}
