// CouchDB reverse proxy that gates `/userdb-*/*` traffic on subscription
// entitlements. Mounted in `server.mjs` for any path matching the
// USERDB_PATH_RE pattern below. JWT verification reuses the signer's public
// key — same logic as `routes.mjs#requireAuth`, repeated here so the proxy
// has no router dependency.

import http from 'node:http';
import { URL } from 'node:url';
import { jwtVerify, importSPKI } from 'jose';

export const USERDB_PATH_RE = /^\/userdb-[a-f0-9]+(\/|$)/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Max-Age': '86400',
};

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

/**
 * Build a request handler for the entitlement-gated CouchDB proxy.
 *
 * @param {{
 *   couchdbUrl: string,
 *   couchdbAuthHeader: string,
 *   signer: { publicPem: () => string } | null,
 *   entitlements: import('./entitlements.mjs').Entitlements,
 *   billingEnabled?: boolean,
 * }} opts
 */
export function createCouchProxy({ couchdbUrl, couchdbAuthHeader, signer, entitlements, billingEnabled = true }) {
  const target = new URL(couchdbUrl);
  let verifyKeyPromise = null;
  function getVerifyKey() {
    if (!signer) return null;
    if (!verifyKeyPromise) verifyKeyPromise = importSPKI(signer.publicPem(), 'RS256');
    return verifyKeyPromise;
  }

  async function authenticate(req) {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) return null;
    const key = getVerifyKey();
    if (!key) return null;
    try {
      const { payload } = await jwtVerify(header.slice('Bearer '.length), await key, {
        issuer: 'tricho-auth',
        audience: 'couchdb',
      });
      return { canonicalUsername: payload.sub };
    } catch {
      return null;
    }
  }

  function denyJson(res, status, body, extraHeaders = {}) {
    res.writeHead(status, {
      ...CORS_HEADERS,
      'content-type': 'application/json',
      ...extraHeaders,
    });
    res.end(JSON.stringify(body));
  }

  return async function handle(req, res) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const identity = await authenticate(req);
    if (!identity) return denyJson(res, 401, { error: 'unauthorized' });

    if (billingEnabled) {
      const result = await entitlements.check(identity.canonicalUsername, 'sync');
      if (!result.allowed) {
        const sub = result.subscription;
        return denyJson(res, 402, {
          error: 'plan_expired',
          reason:
            result.reason === 'no_subscription'
              ? 'no_subscription'
              : result.reason === 'missing_entitlement'
                ? 'sync_entitlement_missing'
                : 'plan_expired',
          paidUntil: sub?.paidUntil ?? null,
          gracePeriodEndsAt: result.gracePeriodEndsAt,
          plan: sub?.plan ?? 'free',
          tier: sub?.tier ?? 'free',
        });
      }
      // In-grace responses get a header so the client can show a banner.
      if (result.inGrace) {
        res.setHeader('tricho-grace-ends-at', String(result.gracePeriodEndsAt));
      }
    }

    forwardRequest(req, res, target, couchdbAuthHeader);
  };
}

function forwardRequest(req, res, target, couchdbAuthHeader) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    if (k.toLowerCase() === 'authorization') continue; // strip user JWT
    headers[k] = v;
  }
  headers.authorization = couchdbAuthHeader;
  headers.host = target.host;

  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      const outHeaders = {};
      for (const [k, v] of Object.entries(upstreamRes.headers)) {
        if (HOP_BY_HOP.has(k.toLowerCase())) continue;
        outHeaders[k] = v;
      }
      // Preserve grace-window header set on `res` before forwarding.
      const graceHeader = res.getHeader('tricho-grace-ends-at');
      if (graceHeader != null) outHeaders['tricho-grace-ends-at'] = String(graceHeader);
      // Always include CORS for browser clients.
      Object.assign(outHeaders, CORS_HEADERS);
      res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    console.error('[tricho-auth] couch proxy upstream error', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { ...CORS_HEADERS, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad_gateway' }));
    } else {
      res.end();
    }
  });
  req.pipe(upstream);
}
