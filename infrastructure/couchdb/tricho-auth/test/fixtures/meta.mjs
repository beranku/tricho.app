// In-memory Meta adapter for unit tests — records every write so the test
// can assert idempotence + ordering without spinning up CouchDB.

export function fakeMeta() {
  const users = new Map();
  const devices = new Map();
  const tokens = new Map();
  const subs = new Map();
  const paymentEvents = new Map();
  const paymentIntents = new Map();
  const backupManifests = new Map();
  const monthlyBackups = new Map();
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
      const now = Date.now();
      const doc = {
        _id: `subscription:${userId}`,
        type: 'subscription',
        userId,
        tier: defaults?.tier ?? 'free',
        plan: defaults?.plan ?? 'free',
        tierKey: defaults?.tierKey ?? 'free',
        billingPeriod: defaults?.billingPeriod ?? null,
        provider: defaults?.provider ?? null,
        status: defaults?.status ?? 'active',
        entitlements: defaults?.entitlements ?? [],
        deviceLimit: defaults?.deviceLimit ?? 1,
        backupRetentionMonths: defaults?.backupRetentionMonths ?? 0,
        gracePeriodSeconds: defaults?.gracePeriodSeconds ?? 7 * 86400,
        freeDeviceGrandfathered: defaults?.freeDeviceGrandfathered ?? false,
        storageLimitMB: defaults?.storageLimitMB ?? 500,
        paidUntil: defaults?.paidUntil ?? null,
        stripeCustomerId: defaults?.stripeCustomerId ?? null,
        stripeSubscriptionId: defaults?.stripeSubscriptionId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      subs.set(userId, doc);
      return doc;
    },

    async listAllSubscriptions() {
      return [...subs.values()];
    },

    async updateSubscription(userId, patch) {
      const existing = subs.get(userId);
      if (!existing) throw new Error(`subscription not found: ${userId}`);
      const merged = { ...existing, ...patch, updatedAt: Date.now() };
      subs.set(userId, merged);
      return merged;
    },

    async creditPaidUntil({ userId, plan, periodSeconds, provider, deviceLimit, backupRetentionMonths, tierKey, billingPeriod, extra = {} }) {
      const existing = subs.get(userId);
      if (!existing) throw new Error(`subscription not found: ${userId}`);
      const now = Date.now();
      const baseMs = Math.max(now, existing.paidUntil ?? 0);
      const merged = {
        ...existing,
        ...extra,
        tier: 'paid',
        plan,
        provider,
        status: 'active',
        entitlements: ['sync', 'backup'],
        paidUntil: baseMs + periodSeconds * 1000,
        updatedAt: now,
      };
      if (tierKey != null) merged.tierKey = tierKey;
      if (billingPeriod != null) merged.billingPeriod = billingPeriod;
      if (deviceLimit != null) merged.deviceLimit = deviceLimit;
      if (backupRetentionMonths != null) merged.backupRetentionMonths = backupRetentionMonths;
      subs.set(userId, merged);
      return merged;
    },

    async findPaymentEvent({ provider, eventId }) {
      return paymentEvents.get(`${provider}:${eventId}`) ?? null;
    },

    async recordPaymentEvent({ provider, eventId, payload = null }) {
      const key = `${provider}:${eventId}`;
      if (paymentEvents.has(key)) return { deduped: true };
      const now = Date.now();
      const doc = {
        _id: `payment-event:${key}`,
        type: 'payment-event',
        provider,
        eventId,
        payload,
        createdAt: now,
        expireAt: now + 30 * 86400 * 1000,
      };
      paymentEvents.set(key, doc);
      return { deduped: false, doc };
    },

    async sweepExpiredPaymentEvents(now = Date.now()) {
      let deleted = 0;
      for (const [key, doc] of paymentEvents) {
        if (doc.expireAt < now) {
          paymentEvents.delete(key);
          deleted += 1;
        }
      }
      return { deleted };
    },

    async findPaymentIntentByVS(vs) {
      for (const doc of paymentIntents.values()) if (doc.vs === vs) return doc;
      return null;
    },

    async getPaymentIntent(intentId) {
      return paymentIntents.get(intentId) ?? null;
    },

    async createPaymentIntent(intent) {
      const doc = { _id: `payment-intent:${intent.intentId}`, type: 'payment-intent', ...intent };
      paymentIntents.set(intent.intentId, doc);
      return doc;
    },

    async updatePaymentIntent(intentId, patch) {
      const existing = paymentIntents.get(intentId);
      if (!existing) throw new Error(`payment intent not found: ${intentId}`);
      const merged = { ...existing, ...patch };
      paymentIntents.set(intentId, merged);
      return merged;
    },

    async listPaymentIntentsByUser(userId) {
      return [...paymentIntents.values()].filter((d) => d.userId === userId);
    },

    async sweepExpiredPaymentIntents(now = Date.now()) {
      let updated = 0;
      for (const doc of paymentIntents.values()) {
        if (doc.status === 'pending' && doc.expiresAt < now) {
          doc.status = 'expired';
          updated += 1;
        }
      }
      return { updated };
    },

    async putBackupManifest(manifest) {
      const key = `${manifest.canonicalUsername}:${manifest.snapshotId}`;
      const doc = { _id: `backup-manifest:${key}`, type: 'backup-manifest', ...manifest };
      backupManifests.set(key, doc);
      return doc;
    },

    async listBackupManifests(canonicalUsername) {
      return [...backupManifests.values()]
        .filter((m) => m.canonicalUsername === canonicalUsername)
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    async getBackupManifest(canonicalUsername, snapshotId) {
      return backupManifests.get(`${canonicalUsername}:${snapshotId}`) ?? null;
    },

    async deleteBackupManifest(canonicalUsername, snapshotId) {
      return backupManifests.delete(`${canonicalUsername}:${snapshotId}`);
    },

    async putMonthlyBackup(manifest) {
      const key = `${manifest.canonicalUsername}:${manifest.monthKey}`;
      const doc = { _id: `monthly-backup:${key}`, type: 'monthly-backup', ...manifest };
      monthlyBackups.set(key, doc);
      return doc;
    },

    async getMonthlyBackup(canonicalUsername, monthKey) {
      return monthlyBackups.get(`${canonicalUsername}:${monthKey}`) ?? null;
    },

    async listMonthlyBackups(canonicalUsername) {
      return [...monthlyBackups.values()]
        .filter((m) => m.canonicalUsername === canonicalUsername)
        .sort((a, b) => (b.monthKey ?? '').localeCompare(a.monthKey ?? ''));
    },

    async deleteMonthlyBackup(canonicalUsername, monthKey) {
      return monthlyBackups.delete(`${canonicalUsername}:${monthKey}`);
    },

    async createCouchUser() { return { created: true }; },
  };

  return {
    meta,
    /** Raw state for assertions. */
    state: { users, devices, tokens, subs, paymentEvents, paymentIntents, backupManifests, monthlyBackups, calls },
  };
}
