/**
 * Token store — bridges OAuth results, the encrypted `_local/server-identity`
 * doc, and PouchDB's fetch override.
 *
 * Invariants:
 * - The access JWT lives only in memory.
 * - The refresh token lives only inside `_local/server-identity`, encrypted
 *   with the vault DEK through the same payload pipeline used for customer
 *   data.
 * - `_local/…` docs are never replicated to CouchDB — this is per-device.
 */

import type { VaultDb } from '../db/pouch';
import {
  encryptPayloadForRxDB,
  decryptPayloadFromRxDB,
  isEncryptedPayload,
  type EncryptedPayload,
} from '../crypto/payload';
import { refreshTokens, type OAuthProvider, type OAuthResult } from './oauth';
import { TabChannel } from '../sync/tab-channel';

export const SERVER_IDENTITY_DOC_ID = '_local/server-identity';

export interface ServerIdentity {
  refreshToken: string;
  refreshTokenExp: number;
  couchdbUsername: string;
  deviceId: string;
  oauthProvider: OAuthProvider;
  oauthEmail: string;
}

interface IdentityDoc {
  _id: typeof SERVER_IDENTITY_DOC_ID;
  _rev?: string;
  type: 'server-identity';
  updatedAt: number;
  payload: EncryptedPayload;
}

interface MemoryState {
  jwt: string | null;
  jwtExp: number;
  refreshToken: string | null;
  refreshTokenExp: number;
  couchdbUsername: string | null;
  deviceId: string | null;
}

const EMPTY: MemoryState = {
  jwt: null,
  jwtExp: 0,
  refreshToken: null,
  refreshTokenExp: 0,
  couchdbUsername: null,
  deviceId: null,
};

export class TokenStore {
  private state: MemoryState = { ...EMPTY };
  private refreshInFlight: Promise<boolean> | null = null;
  private channel: TabChannel;
  private unsubscribeChannel: (() => void) | null = null;

  constructor(private db: VaultDb) {
    this.channel = new TabChannel(db.vaultId);
    this.unsubscribeChannel = this.channel.onMessage((msg) => {
      if (msg.type === 'jwt') {
        // Adopt another tab's fresh JWT. No refresh call needed here.
        this.state.jwt = msg.jwt;
        this.state.jwtExp = msg.jwtExp;
      } else if (msg.type === 'signed-out') {
        this.state = { ...EMPTY };
      }
    });
  }

  dispose(): void {
    this.unsubscribeChannel?.();
    this.channel.close();
  }

  hasIdentity(): boolean {
    return Boolean(this.state.refreshToken);
  }

  jwt(): string | null {
    if (!this.state.jwt) return null;
    if (Date.now() >= this.state.jwtExp * 1000 - 5_000) return null;
    return this.state.jwt;
  }

  couchdbUsername(): string | null {
    return this.state.couchdbUsername;
  }

  deviceId(): string | null {
    return this.state.deviceId;
  }

  snapshot(): Readonly<MemoryState> {
    return this.state;
  }

  /**
   * Decrypts and loads the identity doc from the local PouchDB. Called once
   * per unlock — after this the store has the refresh token in memory and
   * can mint JWTs on demand.
   */
  async load(): Promise<ServerIdentity | null> {
    const doc = (await this.db.pouch.get(SERVER_IDENTITY_DOC_ID).catch(() => null)) as IdentityDoc | null;
    if (!doc || !isEncryptedPayload(doc.payload)) return null;
    const result = await decryptPayloadFromRxDB<ServerIdentity>(doc.payload, {
      dek: this.db.dek,
      expectedKeyId: this.db.vaultId,
      documentId: SERVER_IDENTITY_DOC_ID,
      context: 'server-identity',
    }).catch(() => null);
    if (!result) return null;
    const identity = result.data;
    this.state = {
      jwt: null,
      jwtExp: 0,
      refreshToken: identity.refreshToken,
      refreshTokenExp: identity.refreshTokenExp,
      couchdbUsername: identity.couchdbUsername,
      deviceId: identity.deviceId,
    };
    return identity;
  }

  /**
   * Writes (or overwrites) the identity doc. Used after OAuth or after a
   * successful refresh that rotated the refresh token.
   */
  async save(identity: ServerIdentity): Promise<void> {
    const existing = (await this.db.pouch.get(SERVER_IDENTITY_DOC_ID).catch(() => null)) as IdentityDoc | null;
    const payload = await encryptPayloadForRxDB<ServerIdentity>(identity, {
      dek: this.db.dek,
      keyId: this.db.vaultId,
      documentId: SERVER_IDENTITY_DOC_ID,
      context: 'server-identity',
    });
    const doc: IdentityDoc = {
      _id: SERVER_IDENTITY_DOC_ID,
      ...(existing?._rev ? { _rev: existing._rev } : {}),
      type: 'server-identity',
      updatedAt: Date.now(),
      payload,
    };
    // The vault DB's generic type is BaseEncryptedDoc (customer/visit/photo);
    // this is a _local/… identity doc that shares only the payload envelope.
    // Cast through unknown so the put accepts it.
    await (this.db.pouch as unknown as PouchDB.Database<IdentityDoc>).put(doc);
    this.state = {
      jwt: null,
      jwtExp: 0,
      refreshToken: identity.refreshToken,
      refreshTokenExp: identity.refreshTokenExp,
      couchdbUsername: identity.couchdbUsername,
      deviceId: identity.deviceId,
    };
  }

  /**
   * Deletes the identity doc and clears in-memory state. Used at explicit
   * sign-out or when the server has invalidated our refresh token.
   */
  async clear(): Promise<void> {
    const existing = (await this.db.pouch.get(SERVER_IDENTITY_DOC_ID).catch(() => null)) as IdentityDoc | null;
    if (existing) {
      await this.db.pouch.remove(existing._id, existing._rev!).catch(() => void 0);
    }
    this.state = { ...EMPTY };
  }

  /**
   * Seeds the store from an OAuth result (first install or new device) and
   * persists it as the encrypted identity doc.
   */
  async seedFromOAuth(result: OAuthResult): Promise<void> {
    if (!result.tokens) throw new Error('OAuth result has no tokens (device not approved?)');
    const identity: ServerIdentity = {
      refreshToken: result.tokens.refreshToken,
      refreshTokenExp: result.tokens.refreshTokenExp,
      couchdbUsername: result.couchdbUsername,
      deviceId: result.deviceId,
      oauthProvider: result.provider,
      oauthEmail: result.email,
    };
    await this.save(identity);
    this.state.jwt = result.tokens.jwt;
    this.state.jwtExp = result.tokens.jwtExp;
  }

  /**
   * Ensures an in-memory JWT is fresh (or refreshes it). Returns true on
   * success, false if the refresh was rejected by the server (e.g. revoked
   * device, expired refresh token).
   */
  async ensureFreshJwt(): Promise<boolean> {
    if (this.jwt()) return true;
    if (!this.state.refreshToken || !this.state.deviceId) return false;
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const out = await refreshTokens(this.state.refreshToken!, this.state.deviceId!);
        if (!out) return false;
        this.state.jwt = out.jwt;
        this.state.jwtExp = out.jwtExp;
        this.state.refreshToken = out.refreshToken;
        this.state.refreshTokenExp = out.refreshTokenExp;
        // Persist rotated refresh token.
        const existing = await this.load();
        if (existing) {
          await this.save({
            ...existing,
            refreshToken: out.refreshToken,
            refreshTokenExp: out.refreshTokenExp,
          });
          // save() resets jwt to null — re-seed.
          this.state.jwt = out.jwt;
          this.state.jwtExp = out.jwtExp;
        }
        // Tell other tabs so they skip their own refresh.
        this.channel.post({ type: 'jwt', jwt: out.jwt, jwtExp: out.jwtExp });
        return true;
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  broadcastSignedOut(): void {
    this.channel.post({ type: 'signed-out' });
  }

  /**
   * PouchDB `fetch` override that injects `Authorization: Bearer <jwt>` and
   * transparently refreshes once on a 401 before giving up. On 402, the
   * server is signalling the user's plan does not entitle this request;
   * we throw a typed `PlanExpiredError` so AppShell can route to the Plan
   * screen instead of letting the sync state machine retry forever.
   */
  bearerFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    await this.ensureFreshJwt();
    const attach = (jwt: string | null): RequestInit => {
      if (!jwt) return init;
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${jwt}`);
      return { ...init, headers };
    };
    let res = await fetch(input, attach(this.jwt()));
    if (res.status === 402) await throwPlanExpired(res);
    if (res.status !== 401) return res;
    // One retry after forcing a refresh.
    this.state.jwt = null;
    const ok = await this.ensureFreshJwt();
    if (!ok) return res;
    res = await fetch(input, attach(this.jwt()));
    if (res.status === 402) await throwPlanExpired(res);
    return res;
  };
}

async function throwPlanExpired(res: Response): Promise<never> {
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  const { PlanExpiredError } = await import('./subscription');
  throw new PlanExpiredError({
    paidUntil: typeof body.paidUntil === 'number' ? body.paidUntil : null,
    gracePeriodEndsAt: typeof body.gracePeriodEndsAt === 'number' ? body.gracePeriodEndsAt : null,
    reason: typeof body.reason === 'string' ? body.reason : 'plan_expired',
  });
}
