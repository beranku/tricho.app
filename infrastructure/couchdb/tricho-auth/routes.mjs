// Request router for tricho-auth.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { jwtVerify, importSPKI } from 'jose';
import { issueTokens } from './jwt.mjs';
import * as google from './providers/google.mjs';
import * as apple from './providers/apple.mjs';
import { publicPlanCatalog, getPlan } from './billing/plans.mjs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Max-Age': '86400',
};

const REFRESH_TOKEN_TTL_SEC = 90 * 24 * 60 * 60;
const OAUTH_COOKIE = 'tricho_oauth';
const DEVICE_COOKIE = 'tricho_device';
const OAUTH_COOKIE_TTL_SEC = 10 * 60;
const DEVICE_COOKIE_TTL_SEC = 365 * 24 * 60 * 60;

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { ...CORS_HEADERS, 'content-type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(body));
}

function html(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { ...CORS_HEADERS, 'content-type': 'text/html; charset=utf-8', ...extraHeaders });
  res.end(body);
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { ...CORS_HEADERS, location, ...extraHeaders });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        if (buf.length === 0) return resolve({});
        const type = req.headers['content-type'] ?? '';
        if (type.includes('application/json')) {
          resolve(JSON.parse(buf.toString('utf8')));
        } else if (type.includes('application/x-www-form-urlencoded')) {
          resolve(Object.fromEntries(new URLSearchParams(buf.toString('utf8'))));
        } else {
          resolve(buf.toString('utf8'));
        }
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseCookies(header) {
  const result = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    result[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return result;
}

function setCookie(name, value, { maxAge, secure = true, path = '/', sameSite = 'Lax' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `HttpOnly`, `SameSite=${sameSite}`];
  if (secure) parts.push('Secure');
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; Max-Age=0; SameSite=Lax`;
}

function sign(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function signedCookieValue(secret, obj) {
  const payload = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signature = sign(secret, payload);
  return `${payload}.${signature}`;
}

function verifySignedCookieValue(secret, value) {
  if (!value || typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = sign(secret, payload);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function couchUsernameForSubject(provider, subject) {
  // Canonical, CouchDB-safe: prefix + sha256-hex truncated to 32 chars.
  const hash = createHmac('sha256', `${provider}|${subject}`).digest('hex').slice(0, 32);
  const prefix = provider === 'google' ? 'g_' : provider === 'apple' ? 'a_' : 'u_';
  return `${prefix}${hash}`;
}

function generateCouchPassword() {
  return randomBytes(24).toString('base64url');
}

function generateDeviceId() {
  return randomBytes(16).toString('base64url');
}

function getBackupRoot(env) {
  return env.BACKUP_ROOT ?? null;
}

function enrichSubscription(sub) {
  if (!sub) return null;
  const grace = (sub.gracePeriodSeconds ?? 7 * 86400) * 1000;
  const gracePeriodEndsAt = sub.paidUntil != null ? sub.paidUntil + grace : null;
  return {
    ...sub,
    gracePeriodEndsAt,
  };
}

function isString(v) {
  return typeof v === 'string' && v.length > 0;
}

function resolveDeviceId(cookies) {
  return cookies[DEVICE_COOKIE] ?? null;
}

async function hasRemoteVault(meta, couchdbUsername) {
  // `vault-state` is the well-known doc that indicates a successfully created
  // vault exists on the server. If userdb-<hex> doesn't exist yet or the doc
  // is absent, we return false.
  const hex = Buffer.from(couchdbUsername, 'utf8').toString('hex');
  const url = `${meta.couchdbUrl}/userdb-${hex}/vault-state`;
  const res = await fetch(url, { headers: { authorization: meta.auth } });
  return res.status === 200;
}

// Callback HTML: inlines result JSON, stores in sessionStorage, redirects.
function buildCallbackHtml(result, appOrigin) {
  const json = JSON.stringify(result).replace(/</g, '\\u003c');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Signing you in…</title></head>
<body style="font-family:-apple-system,system-ui,sans-serif;padding:40px;">
<p>Completing sign in…</p>
<script id="tricho-auth-result" type="application/json">${json}</script>
<script>
try {
  var data = JSON.parse(document.getElementById('tricho-auth-result').textContent);
  sessionStorage.setItem('tricho-oauth-result', JSON.stringify(data));
  var target = ${JSON.stringify(appOrigin)} + '/#tricho-auth-complete';
  location.replace(target);
} catch (e) {
  document.body.textContent = 'Sign-in completed but redirect failed. You can close this tab.';
}
</script>
</body></html>`;
}

export function createRouter({ meta, signer, env, entitlements = null }) {
  function invalidateEntitlements(canonicalUsername) {
    if (entitlements && canonicalUsername) entitlements.invalidate(canonicalUsername);
  }
  const COOKIE_SECRET = env.TRICHO_AUTH_COOKIE_SECRET ?? randomBytes(32).toString('base64url');
  const APP_ORIGIN = env.APP_ORIGIN ?? '';
  const googleCfg = google.googleConfig(env);
  const appleCfg = apple.appleConfig(env);

  // Pre-import the JWT verification key. Lazy so unit tests without signer
  // don't fail to boot the router.
  let verifyKeyPromise = null;
  function getVerifyKey() {
    if (!signer) return null;
    if (!verifyKeyPromise) verifyKeyPromise = importSPKI(signer.publicPem(), 'RS256');
    return verifyKeyPromise;
  }

  async function requireAuth(req) {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) return null;
    const token = header.slice('Bearer '.length);
    const key = getVerifyKey();
    if (!key) return null;
    try {
      const { payload } = await jwtVerify(token, await key, { issuer: 'tricho-auth', audience: 'couchdb' });
      return { couchdbUsername: payload.sub, email: payload.email ?? null };
    } catch {
      return null;
    }
  }

  async function onProviderCallback(res, provider, info, { cookies }) {
    const { provider: providerName, subject, email, name, picture } = info;

    const couchdbUsername = couchUsernameForSubject(providerName, subject);

    // Lookup or create user.
    let userDoc = await meta.findUser({ provider: providerName, subject });
    let isNewUser = false;
    if (!userDoc) {
      const couchPassword = generateCouchPassword();
      await meta.createCouchUser(couchdbUsername, couchPassword);
      userDoc = await meta.createUser({
        provider: providerName,
        subject,
        email,
        name,
        picture,
        couchdbUsername,
        couchdbPassword: couchPassword,
      });
      await meta.ensureSubscription(`user:${couchdbUsername}`, {
        tier: 'free',
        plan: 'free',
        provider: null,
        status: 'active',
        entitlements: [],
        deviceLimit: 1,
        gracePeriodSeconds: 7 * 86400,
        freeDeviceGrandfathered: false,
      });
      isNewUser = true;
    } else {
      await meta.touchUser(userDoc);
    }

    // Resolve device id (existing cookie or new one).
    let deviceId = resolveDeviceId(cookies);
    let deviceApproved = true;
    const existingDevices = await meta.listDevices(`user:${couchdbUsername}`);
    let deviceDoc = deviceId ? existingDevices.find((d) => d.deviceId === deviceId && !d.revoked) : null;
    if (!deviceDoc) {
      const sub = await meta.getSubscription(`user:${couchdbUsername}`);
      const baseLimit = sub?.deviceLimit ?? 1;
      // Grandfather: a free user who held two devices before the limit dropped
      // to 1 keeps both, but cannot add a third.
      const limit = sub?.freeDeviceGrandfathered ? Math.max(baseLimit, 2) : baseLimit;
      const active = existingDevices.filter((d) => !d.revoked);
      if (active.length >= limit) {
        deviceApproved = false;
      } else {
        if (!deviceId) deviceId = generateDeviceId();
        deviceDoc = await meta.addDevice({
          userId: `user:${couchdbUsername}`,
          deviceId,
          name: 'New device',
        });
      }
    } else {
      await meta.touchDevice(deviceDoc);
    }

    const remoteVault = isNewUser ? false : await hasRemoteVault(meta, couchdbUsername).catch(() => false);

    let tokensOut = null;
    const extraCookies = [];
    if (deviceApproved) {
      const { jwt, jwtExp, refreshToken } = await issueTokens(signer, { sub: couchdbUsername, email });
      await meta.storeRefreshToken({
        userId: `user:${couchdbUsername}`,
        deviceId,
        refreshToken,
        expiresAt: Date.now() + REFRESH_TOKEN_TTL_SEC * 1000,
      });
      tokensOut = { jwt, jwtExp, refreshToken, refreshTokenExp: Date.now() + REFRESH_TOKEN_TTL_SEC * 1000 };
      extraCookies.push(
        setCookie(DEVICE_COOKIE, deviceId, { maxAge: DEVICE_COOKIE_TTL_SEC }),
      );
    }
    // OAuth working cookie no longer needed.
    extraCookies.push(clearCookie(OAUTH_COOKIE));

    const body = {
      ok: deviceApproved,
      isNewUser,
      deviceApproved,
      hasRemoteVault: remoteVault,
      couchdbUsername,
      email,
      name,
      picture,
      provider: providerName,
      deviceId,
      devices: existingDevices
        .filter((d) => !d.revoked)
        .map((d) => ({ id: d.deviceId, name: d.name, addedAt: d.addedAt, lastSeenAt: d.lastSeenAt })),
      subscription: enrichSubscription(
        await meta.getSubscription(`user:${couchdbUsername}`).catch(() => null),
      ),
      tokens: tokensOut,
    };

    const htmlBody = buildCallbackHtml(body, APP_ORIGIN);
    res.writeHead(200, {
      ...CORS_HEADERS,
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': extraCookies,
    });
    res.end(htmlBody);
  }

  return async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const cookies = parseCookies(req.headers.cookie);

    try {
      if (req.method === 'GET' && (path === '/health' || path === '/auth/health')) {
        return json(res, 200, { ok: true });
      }

      // ── Google OAuth ───────────────────────────────────────────────────
      if (req.method === 'GET' && path === '/auth/google/start') {
        if (!googleCfg) return json(res, 503, { error: 'google_not_configured' });
        const { url: authUrl, state, nonce, codeVerifier } = await google.startAuthorize(googleCfg);
        const cookieValue = signedCookieValue(COOKIE_SECRET, {
          provider: 'google',
          state,
          nonce,
          codeVerifier,
          createdAt: Date.now(),
        });
        return redirect(res, authUrl, {
          'set-cookie': setCookie(OAUTH_COOKIE, cookieValue, { maxAge: OAUTH_COOKIE_TTL_SEC }),
        });
      }

      if (req.method === 'GET' && path === '/auth/google/callback') {
        if (!googleCfg) return json(res, 503, { error: 'google_not_configured' });
        const working = verifySignedCookieValue(COOKIE_SECRET, cookies[OAUTH_COOKIE]);
        if (!working || working.provider !== 'google') {
          return html(res, 400, '<p>Invalid OAuth session. Try again.</p>');
        }
        const query = Object.fromEntries(url.searchParams);
        if (query.state !== working.state) {
          return html(res, 400, '<p>State mismatch. Try again.</p>');
        }
        let info;
        try {
          info = await google.handleCallback(googleCfg, {
            query,
            state: working.state,
            nonce: working.nonce,
            codeVerifier: working.codeVerifier,
          });
        } catch (err) {
          console.error('[tricho-auth] google callback failed', err);
          return html(res, 400, '<p>Sign-in failed. Try again.</p>');
        }
        return onProviderCallback(res, 'google', info, { cookies });
      }

      // ── Apple OAuth ─────────────────────────────────────────────────────
      if (req.method === 'GET' && path === '/auth/apple/start') {
        if (!appleCfg) return json(res, 503, { error: 'apple_not_configured' });
        const { url: authUrl, state, nonce } = await apple.startAuthorize(appleCfg);
        const cookieValue = signedCookieValue(COOKIE_SECRET, {
          provider: 'apple',
          state,
          nonce,
          createdAt: Date.now(),
        });
        return redirect(res, authUrl, {
          'set-cookie': setCookie(OAUTH_COOKIE, cookieValue, {
            maxAge: OAUTH_COOKIE_TTL_SEC,
            // Apple posts the callback cross-site, so SameSite must be None
            // for the OAuth state cookie to survive the round-trip.
            sameSite: 'None',
          }),
        });
      }

      if (req.method === 'POST' && path === '/auth/apple/callback') {
        if (!appleCfg) return json(res, 503, { error: 'apple_not_configured' });
        const working = verifySignedCookieValue(COOKIE_SECRET, cookies[OAUTH_COOKIE]);
        if (!working || working.provider !== 'apple') {
          return html(res, 400, '<p>Invalid OAuth session. Try again.</p>');
        }
        const form = await readBody(req);
        let info;
        try {
          info = await apple.handleCallback(appleCfg, { form, state: working.state, nonce: working.nonce });
        } catch (err) {
          console.error('[tricho-auth] apple callback failed', err);
          return html(res, 400, '<p>Apple sign-in failed. Try again.</p>');
        }
        return onProviderCallback(res, 'apple', info, { cookies });
      }

      // ── JWT refresh ────────────────────────────────────────────────────
      if (req.method === 'POST' && path === '/auth/refresh') {
        if (!signer) return json(res, 501, { error: 'jwt_not_configured' });
        const body = await readBody(req);
        const { refreshToken, deviceId } = body ?? {};
        if (!isString(refreshToken) || !isString(deviceId))
          return json(res, 400, { error: 'invalid_request' });
        const tokenDoc = await meta.findRefreshToken(refreshToken);
        if (!tokenDoc || tokenDoc.revoked || tokenDoc.expiresAt < Date.now())
          return json(res, 401, { error: 'invalid_refresh_token' });
        if (tokenDoc.deviceId !== deviceId) {
          await meta.revokeRefreshToken(tokenDoc);
          return json(res, 401, { error: 'device_mismatch' });
        }

        // Load the user to enrich the JWT + response.
        const userDocId = tokenDoc.userId.startsWith('user:')
          ? tokenDoc.userId.slice('user:'.length)
          : tokenDoc.userId;
        let userDoc = null;
        try {
          const res1 = await fetch(
            `${meta.couchdbUrl}/${meta.dbName}/user:${encodeURIComponent(userDocId)}`,
            { headers: { authorization: meta.auth } },
          );
          if (res1.ok) userDoc = await res1.json();
        } catch {}
        const sub = userDoc?.couchdbUsername ?? userDocId;
        const email = userDoc?.email ?? null;

        await meta.revokeRefreshToken(tokenDoc);
        const { jwt, jwtExp, refreshToken: nextRefresh } = await issueTokens(signer, { sub, email });
        await meta.storeRefreshToken({
          userId: tokenDoc.userId,
          deviceId: tokenDoc.deviceId,
          refreshToken: nextRefresh,
          expiresAt: Date.now() + REFRESH_TOKEN_TTL_SEC * 1000,
        });
        return json(res, 200, {
          jwt,
          jwtExp,
          refreshToken: nextRefresh,
          refreshTokenExp: Date.now() + REFRESH_TOKEN_TTL_SEC * 1000,
        });
      }

      // ── Session (cookie-based probe — not currently set; returns 401 so
      //    the PWA can treat missing session as "needs OAuth")  ───────────
      if (req.method === 'GET' && path === '/auth/session')
        return json(res, 401, { authenticated: false });

      if (req.method === 'POST' && path === '/auth/logout') {
        const body = await readBody(req).catch(() => ({}));
        if (body?.refreshToken) {
          const tokenDoc = await meta.findRefreshToken(body.refreshToken).catch(() => null);
          if (tokenDoc) await meta.revokeRefreshToken(tokenDoc).catch(() => null);
        }
        return json(res, 200, { ok: true }, {
          'set-cookie': [clearCookie(DEVICE_COOKIE)],
        });
      }

      // ── Device management ─────────────────────────────────────────────
      if (req.method === 'GET' && path === '/auth/devices') {
        const identity = await requireAuth(req);
        if (!identity) return json(res, 401, { error: 'unauthorized' });
        const userId = `user:${identity.couchdbUsername}`;
        const devices = await meta.listDevices(userId);
        const sub = await meta.getSubscription(userId);
        return json(res, 200, {
          devices: devices
            .filter((d) => !d.revoked)
            .map((d) => ({
              id: d.deviceId,
              name: d.name,
              addedAt: d.addedAt,
              lastSeenAt: d.lastSeenAt,
            })),
          subscription: sub,
        });
      }

      if (req.method === 'DELETE' && path.startsWith('/auth/devices/')) {
        const identity = await requireAuth(req);
        if (!identity) return json(res, 401, { error: 'unauthorized' });
        const deviceId = decodeURIComponent(path.slice('/auth/devices/'.length));
        if (!isString(deviceId)) return json(res, 400, { error: 'invalid_device_id' });
        const userId = `user:${identity.couchdbUsername}`;
        const revoked = await meta.revokeDevice(userId, deviceId);
        if (!revoked) return json(res, 404, { error: 'device_not_found' });
        // Invalidate any outstanding refresh tokens for this device.
        await meta.revokeAllTokensForDevice(userId, deviceId).catch(() => null);
        return json(res, 200, { ok: true });
      }

      if (req.method === 'GET' && path === '/auth/plans') {
        return json(res, 200, { plans: publicPlanCatalog(env) });
      }

      if (req.method === 'GET' && path === '/auth/subscription') {
        const identity = await requireAuth(req);
        if (!identity) return json(res, 401, { error: 'unauthorized' });
        const sub = await meta.getSubscription(`user:${identity.couchdbUsername}`);
        return json(res, 200, { subscription: enrichSubscription(sub) });
      }

      // ── Billing: Stripe ────────────────────────────────────────────────
      if (req.method === 'POST' && path === '/auth/billing/stripe/checkout') {
        if (env.BILLING_ENABLED !== 'true') return json(res, 503, { error: 'billing_disabled' });
        const identity = await requireAuth(req);
        if (!identity) return json(res, 401, { error: 'unauthorized' });
        const body = (await readBody(req).catch(() => ({}))) || {};
        const { plan, successUrl, cancelUrl } = body;
        const PAID = ['pro-monthly', 'pro-yearly', 'max-monthly', 'max-yearly'];
        if (!PAID.includes(plan)) return json(res, 400, { error: 'invalid_plan' });
        if (!isString(successUrl) || !isString(cancelUrl)) return json(res, 400, { error: 'invalid_urls' });
        const userId = `user:${identity.couchdbUsername}`;
        const sub = await meta.getSubscription(userId);
        if (sub?.provider === 'stripe' && sub.status === 'active') {
          return json(res, 409, { error: 'active_subscription', provider: 'stripe' });
        }
        // Bridge from existing bank-transfer paidUntil with a Stripe trial.
        let trialDays = 0;
        if (sub?.provider === 'bank-transfer' && sub.paidUntil != null && sub.paidUntil > Date.now()) {
          trialDays = Math.ceil((sub.paidUntil - Date.now()) / (86400 * 1000));
        }
        try {
          const { createCheckoutSession } = await import('./billing/stripe.mjs');
          const result = await createCheckoutSession({
            env,
            user: { canonicalUsername: identity.couchdbUsername, email: identity.email },
            plan,
            successUrl,
            cancelUrl,
            trialDays,
          });
          // Persist the customerId hint so we can recover it without round-tripping.
          if (result.customerId && (!sub || sub.stripeCustomerId !== result.customerId)) {
            await meta.updateSubscription(userId, { stripeCustomerId: result.customerId });
          }
          return json(res, 200, { checkoutUrl: result.checkoutUrl });
        } catch (err) {
          console.error('[tricho-auth] stripe checkout failed', err);
          return json(res, 500, { error: 'stripe_failed' });
        }
      }

      if (req.method === 'GET' && path === '/auth/billing/stripe/portal') {
        if (env.BILLING_ENABLED !== 'true') return json(res, 503, { error: 'billing_disabled' });
        const identity = await requireAuth(req);
        if (!identity) return json(res, 401, { error: 'unauthorized' });
        const sub = await meta.getSubscription(`user:${identity.couchdbUsername}`);
        if (!sub?.stripeCustomerId) return json(res, 409, { error: 'no_stripe_customer' });
        const returnUrl = url.searchParams.get('return_url') ?? env.APP_ORIGIN ?? '/';
        try {
          const { openCustomerPortal } = await import('./billing/stripe.mjs');
          const { portalUrl } = await openCustomerPortal({
            env,
            stripeCustomerId: sub.stripeCustomerId,
            returnUrl,
          });
          return json(res, 200, { portalUrl });
        } catch (err) {
          console.error('[tricho-auth] stripe portal failed', err);
          return json(res, 500, { error: 'stripe_failed' });
        }
      }

      if (req.method === 'POST' && path === '/auth/billing/stripe/webhook') {
        if (env.BILLING_ENABLED !== 'true') return json(res, 503, { error: 'billing_disabled' });
        const rawBody = await readRawBody(req);
        try {
          const { handleStripeWebhook } = await import('./billing/webhook.mjs');
          const result = await handleStripeWebhook({
            meta,
            entitlements,
            env,
            rawBody,
            signatureHeader: req.headers['stripe-signature'],
          });
          return json(res, result.status, result.body);
        } catch (err) {
          console.error('[tricho-auth] stripe webhook handler failed', err);
          return json(res, 500, { error: 'webhook_failed' });
        }
      }

      // ── Billing: Bank transfer ─────────────────────────────────────────
      if (req.method === 'POST' && path === '/auth/billing/bank-transfer/intent') {
        if (env.BILLING_ENABLED !== 'true') return json(res, 503, { error: 'billing_disabled' });
        const identity = await requireAuth(req);
        if (!identity) return json(res, 401, { error: 'unauthorized' });
        const body = (await readBody(req).catch(() => ({}))) || {};
        const { plan } = body;
        const PAID = ['pro-monthly', 'pro-yearly', 'max-monthly', 'max-yearly'];
        if (!PAID.includes(plan)) return json(res, 400, { error: 'invalid_plan' });
        const userId = `user:${identity.couchdbUsername}`;
        const sub = await meta.getSubscription(userId);
        if (sub?.provider === 'stripe' && sub.status === 'active') {
          return json(res, 409, { error: 'active_subscription', provider: 'stripe' });
        }
        try {
          const { createIntent } = await import('./billing/bank-transfer.mjs');
          const intent = await createIntent({ meta, env, userId, plan });
          return json(res, 200, { intent });
        } catch (err) {
          console.error('[tricho-auth] create bank-transfer intent failed', err);
          return json(res, 500, { error: 'bank_transfer_failed' });
        }
      }

      if (req.method === 'GET' && path.startsWith('/auth/billing/bank-transfer/intent/')) {
        const identity = await requireAuth(req);
        if (!identity) return json(res, 401, { error: 'unauthorized' });
        const intentId = decodeURIComponent(path.slice('/auth/billing/bank-transfer/intent/'.length));
        if (!isString(intentId)) return json(res, 400, { error: 'invalid_intent_id' });
        const intent = await meta.getPaymentIntent(intentId);
        if (!intent) return json(res, 404, { error: 'intent_not_found' });
        if (intent.userId !== `user:${identity.couchdbUsername}`) return json(res, 403, { error: 'forbidden' });
        return json(res, 200, { intent });
      }

      if (req.method === 'DELETE' && path.startsWith('/auth/billing/bank-transfer/intent/')) {
        const identity = await requireAuth(req);
        if (!identity) return json(res, 401, { error: 'unauthorized' });
        const intentId = decodeURIComponent(path.slice('/auth/billing/bank-transfer/intent/'.length));
        const { cancelIntent } = await import('./billing/bank-transfer.mjs');
        const result = await cancelIntent({
          meta,
          intentId,
          userId: `user:${identity.couchdbUsername}`,
        });
        return json(res, result.status, result.body);
      }

      if (req.method === 'POST' && path === '/auth/billing/bank-transfer/admin/confirm') {
        const adminToken = env.BILLING_ADMIN_TOKEN ?? null;
        const provided = (req.headers.authorization ?? '').replace(/^Bearer\s+/, '');
        if (!adminToken || provided !== adminToken) return json(res, 401, { error: 'unauthorized' });
        const body = (await readBody(req).catch(() => ({}))) || {};
        const { intentId } = body;
        if (!isString(intentId)) return json(res, 400, { error: 'invalid_intent_id' });
        const { confirmIntent } = await import('./billing/bank-transfer.mjs');
        const result = await confirmIntent({ meta, env, intentId });
        if (result.status === 200 && result.body?.intent) {
          // Invalidate cache for the user so subsequent sync requests pass.
          const userId = result.body.intent.userId;
          if (userId?.startsWith('user:')) invalidateEntitlements(userId.slice('user:'.length));
        }
        return json(res, result.status, result.body);
      }

      if (req.method === 'POST' && path === '/auth/subscription/cancel') {
        const identity = await requireAuth(req);
        if (!identity) return json(res, 401, { error: 'unauthorized' });
        const userId = `user:${identity.couchdbUsername}`;
        const sub = await meta.getSubscription(userId);
        if (!sub || sub.tier === 'free') return json(res, 400, { error: 'no_active_subscription' });
        if (sub.provider === 'stripe') {
          if (typeof env.STRIPE_SECRET_KEY === 'string' && sub.stripeSubscriptionId) {
            // Best-effort Stripe API call. The webhook will be the canonical
            // writer of `status: "canceled"`; we set it locally too so the UI
            // reflects the intent immediately.
            try {
              const { cancelStripeSubscription } = await import('./billing/stripe.mjs');
              await cancelStripeSubscription({
                env,
                stripeSubscriptionId: sub.stripeSubscriptionId,
              });
            } catch (err) {
              console.warn('[tricho-auth] stripe cancel failed', err.message);
            }
          }
          await meta.updateSubscription(userId, { status: 'canceled' });
          invalidateEntitlements(identity.couchdbUsername);
          return json(res, 200, { ok: true });
        }
        // Bank-transfer: no auto-renew exists, so cancel is just a flag.
        await meta.updateSubscription(userId, { status: 'canceled' });
        invalidateEntitlements(identity.couchdbUsername);
        return json(res, 200, { ok: true });
      }

      // ── Monthly backups ───────────────────────────────────────────────
      if (req.method === 'GET' && path === '/auth/backup/months') {
        const identity = await requireAuth(req);
        if (!identity) return json(res, 401, { error: 'unauthorized' });
        const months = await meta.listMonthlyBackups(identity.couchdbUsername);
        return json(res, 200, {
          months: months.map((m) => ({
            monthKey: m.monthKey,
            sizeBytes: m.sizeBytes ?? 0,
            finalized: Boolean(m.finalized),
            docCount: m.docCount ?? 0,
            photoCount: m.photoCount ?? 0,
            generatedAt: m.generatedAt ?? 0,
          })),
        });
      }

      const monthMatch = path.match(/^\/auth\/backup\/months\/(\d{4}-\d{2})$/);
      if (req.method === 'GET' && monthMatch) {
        const identity = await requireAuth(req);
        if (!identity) return json(res, 401, { error: 'unauthorized' });
        if (env.BILLING_ENABLED === 'true' && entitlements) {
          const r = await entitlements.check(identity.couchdbUsername, 'backup');
          if (!r.allowed) {
            return json(res, 402, {
              error: 'plan_expired',
              reason: 'backup_entitlement_missing',
              paidUntil: r.subscription?.paidUntil ?? null,
              gracePeriodEndsAt: r.gracePeriodEndsAt,
            });
          }
        }
        const monthKey = monthMatch[1];
        const manifest = await meta.getMonthlyBackup(identity.couchdbUsername, monthKey);
        if (!manifest) return json(res, 404, { error: 'not_found' });
        if (!getBackupRoot(env)) return json(res, 503, { error: 'backup_storage_not_configured' });
        try {
          const { BackupStore } = await import('./billing/backup-store.mjs');
          const store = new BackupStore({ root: getBackupRoot(env) });
          if (!(await store.existsMonth({ canonicalUsername: identity.couchdbUsername, monthKey }))) {
            return json(res, 404, { error: 'not_found' });
          }
          res.writeHead(200, {
            ...CORS_HEADERS,
            'content-type': 'application/zip',
            'content-length': String(manifest.sizeBytes ?? 0),
            'content-disposition': `attachment; filename="${monthKey}.tricho-backup.zip"`,
          });
          const stream = store.openMonthReadStream({ canonicalUsername: identity.couchdbUsername, monthKey });
          stream.pipe(res);
          return undefined;
        } catch (err) {
          console.error('[tricho-auth] monthly backup download failed', err);
          return json(res, 500, { error: 'backup_download_failed' });
        }
      }

      // ── JWKS ───────────────────────────────────────────────────────────
      if (req.method === 'GET' && path === '/auth/.well-known/jwks.json') {
        if (!signer) return json(res, 501, { error: 'jwt_not_configured' });
        return json(res, 200, await signer.jwks(), {
          'cache-control': 'public, max-age=300',
        });
      }

      return json(res, 404, { error: 'not_found' });
    } catch (err) {
      console.error('[tricho-auth] handler error', err);
      return json(res, 500, { error: 'internal_error' });
    }
  };
}

export const _internals = {
  couchUsernameForSubject,
  signedCookieValue,
  verifySignedCookieValue,
  parseCookies,
};
