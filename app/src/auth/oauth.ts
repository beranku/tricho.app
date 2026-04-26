/**
 * Client-side helpers for the OAuth identity flow.
 *
 * The OAuth dance is server-driven: the PWA redirects to /auth/<provider>/start,
 * the provider redirects back to /auth/<provider>/callback, and the server's
 * callback renders HTML that stores the result in sessionStorage + redirects
 * back to the PWA with a hash marker. This module exposes small helpers for
 * kicking off the redirects and reading the result on re-entry.
 */

const AUTH_ORIGIN = (import.meta.env?.VITE_AUTH_PROXY_URL as string | undefined) ?? 'http://localhost:4545';
const SESSION_STORAGE_KEY = 'tricho-oauth-result';
export const AUTH_COMPLETE_HASH = '#tricho-auth-complete';

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
 * Reads the result the callback HTML stashed in sessionStorage. Returns null
 * if no pending OAuth completion is present. Idempotent: calling it twice
 * gives null on the second call.
 */
export function consumePendingOAuthResult(): OAuthResult | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return JSON.parse(raw) as OAuthResult;
  } catch {
    return null;
  }
}

/**
 * If the current URL carries the auth-complete hash, remove it — call this
 * right after reading the pending result so the hash doesn't linger in
 * browser history.
 */
export function clearAuthCompleteHash(): void {
  if (window.location.hash === AUTH_COMPLETE_HASH) {
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
