// Fixture-driven Stripe-client stub.
//
// Loads a JSON fixture from test/fixtures/stripe/ and returns an object
// shaped like the Stripe SDK that `_setStripeClient(...)` can install. Each
// SDK call site (`stripe.<resource>.<method>(...)`) is matched against the
// fixture's `calls[]` in order; the first unconsumed match returns the
// fixture's response (or throws the typed error). A fixture entry can declare
// `replayCacheKey` to make subsequent calls with the same idempotency-key
// return the cached body — this is how we test idempotent replay without
// the real Stripe SDK.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class StripeCardError extends Error {
  constructor({ code, decline_code, message }) {
    super(message ?? 'Card error');
    this.name = 'StripeCardError';
    this.type = 'StripeCardError';
    this.code = code;
    this.decline_code = decline_code;
  }
}

const ERROR_CLASSES = {
  StripeCardError,
};

function buildResponse({ respond, replayed }) {
  if (respond.kind === 'error') {
    const Cls = ERROR_CLASSES[respond.errorClass];
    if (!Cls) throw new Error(`Unknown Stripe error class in fixture: ${respond.errorClass}`);
    throw new Cls({
      code: respond.code,
      decline_code: respond.decline_code,
      message: respond.message,
    });
  }
  if (respond.kind === 'value') {
    // Tag replayed responses so the test can assert exactly that.
    return replayed ? { ...respond.value, _replayed: true } : respond.value;
  }
  throw new Error(`Unknown respond.kind in fixture: ${respond.kind}`);
}

export function loadStripeFixture(name) {
  const file = path.resolve(__dirname, 'stripe', `${name}.json`);
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(fixture.calls)) {
    throw new Error(`fixture ${name} is missing calls[]`);
  }

  const queue = [...fixture.calls];
  const replayCache = new Map(); // replayCacheKey -> response value

  function makeMethod(resource, method) {
    return async function (..._args) {
      const opts = _args[_args.length - 1];
      const idempotencyKey =
        opts && typeof opts === 'object' && 'idempotencyKey' in opts ? opts.idempotencyKey : undefined;

      // Replay-by-idempotency: if a prior call cached a response under this
      // resource+method+key, return it without consuming a fixture entry.
      if (idempotencyKey) {
        const cacheLookupKey = `${resource}.${method}:${idempotencyKey}`;
        if (replayCache.has(cacheLookupKey)) {
          return buildResponse({ respond: { kind: 'value', value: replayCache.get(cacheLookupKey) }, replayed: true });
        }
        // Search the queue for a matching entry that defines a replayCacheKey.
        const idx = queue.findIndex(
          (e) => e.match.resource === resource && e.match.method === method,
        );
        if (idx >= 0) {
          const entry = queue.splice(idx, 1)[0];
          if (entry.respond.replayCacheKey) {
            replayCache.set(cacheLookupKey, entry.respond.value);
          }
          return buildResponse({ respond: entry.respond, replayed: false });
        }
      }

      const idx = queue.findIndex(
        (e) => e.match.resource === resource && e.match.method === method,
      );
      if (idx < 0) {
        throw new Error(
          `No fixture entry for ${resource}.${method} (queue empty or method unmatched)`,
        );
      }
      const entry = queue.splice(idx, 1)[0];
      return buildResponse({ respond: entry.respond, replayed: false });
    };
  }

  // Build the resource map lazily — every method we touch is materialised on
  // first access. This avoids enumerating Stripe's full surface up front.
  function makeResource(resourceName) {
    return new Proxy(
      {},
      {
        get(_t, method) {
          return makeMethod(resourceName, String(method));
        },
      },
    );
  }

  const stripeLike = new Proxy(
    {},
    {
      get(_t, resource) {
        // Stripe nests `checkout.sessions`, `billingPortal.sessions` etc.
        if (resource === 'checkout') return { sessions: makeResource('checkout.sessions') };
        if (resource === 'billingPortal') return { sessions: makeResource('billingPortal.sessions') };
        return makeResource(String(resource));
      },
    },
  );

  return { client: stripeLike, queue, replayCache };
}

export { StripeCardError };
