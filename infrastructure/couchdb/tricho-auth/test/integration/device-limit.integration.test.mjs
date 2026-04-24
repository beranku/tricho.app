import { describe, it } from 'vitest';

// TODO (tracked follow-up): seed a user with two active devices in a
// real CouchDB-backed Meta, drive a third OAuth callback path through
// routes.mjs, assert:
//   - response carries deviceApproved: false
//   - no new device row in tricho_meta
//   - no refresh token minted
//
// The fakeMeta in unit tier covers this logic flow already; integration
// tier catches regressions in the real DB view behaviour (subscriptions
// lookup, device list join).

describe('device-limit enforcement end-to-end', () => {
  it.todo('third device rejected on free tier');
  it.todo('revoking a device frees a slot for the next callback');
});
