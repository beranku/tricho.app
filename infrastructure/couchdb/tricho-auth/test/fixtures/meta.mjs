// In-memory Meta adapter for unit tests — records every write so the test
// can assert idempotence + ordering without spinning up CouchDB.

export function fakeMeta() {
  const users = new Map();
  const devices = new Map();
  const tokens = new Map();
  const subs = new Map();
  const calls = { put: 0, delete: 0, ensureDatabase: 0 };

  const meta = {
    couchdbUrl: 'http://fakecouch:5984',
    dbName: 'tricho_meta_fake',
    auth: 'Basic fake',

    async ensureDatabase() {
      calls.ensureDatabase += 1;
    },

    async findUser({ provider, subject }) {
      for (const u of users.values()) {
        if (u.provider === provider && u.subject === subject) return u;
      }
      return null;
    },

    async createUser(input) {
      calls.put += 1;
      const doc = { _id: `user:${input.couchdbUsername}`, type: 'user', createdAt: Date.now(), lastSeenAt: Date.now(), ...input };
      users.set(doc._id, doc);
      return doc;
    },

    async touchUser(userDoc) {
      userDoc.lastSeenAt = Date.now();
      users.set(userDoc._id, userDoc);
    },

    async listDevices(userId) {
      return [...devices.values()].filter((d) => d.userId === userId);
    },

    async addDevice({ userId, deviceId, name }) {
      calls.put += 1;
      const doc = {
        _id: `device:${userId}:${deviceId}`,
        type: 'device',
        userId,
        deviceId,
        name: name ?? 'Test device',
        addedAt: Date.now(),
        lastSeenAt: Date.now(),
        revoked: false,
      };
      devices.set(doc._id, doc);
      return doc;
    },

    async touchDevice(doc) {
      doc.lastSeenAt = Date.now();
      devices.set(doc._id, doc);
    },

    async revokeDevice(userId, deviceId) {
      const key = `device:${userId}:${deviceId}`;
      const d = devices.get(key);
      if (!d) return false;
      d.revoked = true;
      d.revokedAt = Date.now();
      devices.set(key, d);
      return true;
    },

    async storeRefreshToken({ userId, deviceId, refreshToken, expiresAt }) {
      calls.put += 1;
      const doc = {
        _id: `token:${refreshToken}`, // simplified: no hashing in fake
        tokenHash: refreshToken,
        userId,
        deviceId,
        issuedAt: Date.now(),
        expiresAt,
        revoked: false,
      };
      tokens.set(refreshToken, doc);
      return doc;
    },

    async findRefreshToken(refreshToken) {
      return tokens.get(refreshToken) ?? null;
    },

    async revokeRefreshToken(doc) {
      doc.revoked = true;
      doc.revokedAt = Date.now();
    },

    async revokeAllTokensForDevice(userId, deviceId) {
      for (const t of tokens.values()) {
        if (t.userId === userId && t.deviceId === deviceId) {
          t.revoked = true;
          t.revokedAt = Date.now();
        }
      }
    },

    async getSubscription(userId) {
      return subs.get(userId) ?? null;
    },

    async ensureSubscription(userId, defaults) {
      const existing = subs.get(userId);
      if (existing) return existing;
      const doc = {
        _id: `subscription:${userId}`,
        userId,
        tier: defaults?.tier ?? 'free',
        deviceLimit: defaults?.deviceLimit ?? 2,
        storageLimitMB: defaults?.storageLimitMB ?? 500,
        paidUntil: null,
        updatedAt: Date.now(),
      };
      subs.set(userId, doc);
      return doc;
    },

    async createCouchUser() { return { created: true }; },
  };

  return {
    meta,
    /** Raw state for assertions. */
    state: { users, devices, tokens, subs, calls },
  };
}
