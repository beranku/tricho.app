// CouchDB admin wrapper for the `tricho_meta` database.
//
// `tricho_meta` holds user, device, token, and subscription records — everything
// that is operational identity state, never user data. It is admin-only; no
// end-user ever authenticates to it.

const encoder = new TextEncoder();

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

export class Meta {
  constructor({ couchdbUrl, adminUser, adminPassword, dbName }) {
    this.couchdbUrl = couchdbUrl.replace(/\/$/, '');
    this.dbName = dbName;
    this.auth =
      'Basic ' + Buffer.from(`${adminUser}:${adminPassword}`).toString('base64');
  }

  async ensureDatabase() {
    // PUT is idempotent — 201 (created) and 412 (already exists) are both fine.
    const res = await fetch(`${this.couchdbUrl}/${this.dbName}`, {
      method: 'PUT',
      headers: { authorization: this.auth },
    });
    if (res.status !== 201 && res.status !== 412) {
      const body = await res.text().catch(() => '');
      throw new Error(`ensureDatabase failed (${res.status}): ${body}`);
    }
    // Seed design doc for typed lookups; idempotent with an `update_if_different`
    // check based on revision.
    await this.#seedDesignDoc();
  }

  async #seedDesignDoc() {
    const ddoc = {
      _id: '_design/tricho',
      language: 'javascript',
      views: {
        users_by_provider_subject: {
          map: "function (doc) { if (doc.type === 'user') emit([doc.provider, doc.subject], null); }",
        },
        users_by_email: {
          map: "function (doc) { if (doc.type === 'user') emit(doc.email, null); }",
        },
        devices_by_user: {
          map: "function (doc) { if (doc.type === 'device') emit(doc.userId, null); }",
        },
        tokens_by_hash: {
          map: "function (doc) { if (doc.type === 'token') emit(doc.tokenHash, null); }",
        },
        subscriptions_by_user: {
          map: "function (doc) { if (doc.type === 'subscription') emit(doc.userId, null); }",
        },
        payment_intents_by_user: {
          map: "function (doc) { if (doc.type === 'payment-intent') emit(doc.userId, null); }",
        },
        payment_intents_by_vs: {
          map: "function (doc) { if (doc.type === 'payment-intent') emit(doc.vs, null); }",
        },
        payment_events_by_id: {
          map: "function (doc) { if (doc.type === 'payment-event') emit([doc.provider, doc.eventId], null); }",
        },
        backup_manifests_by_user: {
          map: "function (doc) { if (doc.type === 'backup-manifest') emit([doc.canonicalUsername, doc.createdAt], null); }",
        },
        monthly_backups_by_user: {
          map: "function (doc) { if (doc.type === 'monthly-backup') emit([doc.canonicalUsername, doc.monthKey], null); }",
        },
      },
    };
    const existing = await this.#get(ddoc._id).catch(() => null);
    if (existing) ddoc._rev = existing._rev;
    await this.#put(ddoc);
  }

  async #get(docId) {
    const res = await fetch(
      `${this.couchdbUrl}/${this.dbName}/${encodeURIComponent(docId)}`,
      { headers: { authorization: this.auth } },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`get ${docId} failed (${res.status})`);
    return res.json();
  }

  async #put(doc) {
    const res = await fetch(
      `${this.couchdbUrl}/${this.dbName}/${encodeURIComponent(doc._id)}`,
      {
        method: 'PUT',
        headers: { authorization: this.auth, 'content-type': 'application/json' },
        body: JSON.stringify(doc),
      },
    );
    if (res.status === 409) throw new Error(`conflict on ${doc._id}`);
    if (!res.ok) throw new Error(`put ${doc._id} failed (${res.status})`);
    return res.json();
  }

  async #delete(docId, rev) {
    const res = await fetch(
      `${this.couchdbUrl}/${this.dbName}/${encodeURIComponent(docId)}?rev=${encodeURIComponent(rev)}`,
      { method: 'DELETE', headers: { authorization: this.auth } },
    );
    if (res.status === 404) return;
    if (!res.ok) throw new Error(`delete ${docId} failed (${res.status})`);
  }

  async #view(name, opts = {}) {
    const qs = new URLSearchParams();
    if (opts.key !== undefined) qs.set('key', JSON.stringify(opts.key));
    if (opts.startkey !== undefined) qs.set('startkey', JSON.stringify(opts.startkey));
    if (opts.endkey !== undefined) qs.set('endkey', JSON.stringify(opts.endkey));
    qs.set('include_docs', 'true');
    const res = await fetch(
      `${this.couchdbUrl}/${this.dbName}/_design/tricho/_view/${name}?${qs}`,
      { headers: { authorization: this.auth } },
    );
    if (!res.ok) throw new Error(`view ${name} failed (${res.status})`);
    const body = await res.json();
    return (body.rows ?? []).map((row) => row.doc);
  }

  // ─── users ──────────────────────────────────────────────────────────────

  async findUser({ provider, subject }) {
    const rows = await this.#view('users_by_provider_subject', { key: [provider, subject] });
    return rows[0] ?? null;
  }

  async findUserByEmail(email) {
    const rows = await this.#view('users_by_email', { key: email });
    return rows[0] ?? null;
  }

  async createUser({ provider, subject, email, name, picture, couchdbUsername, couchdbPassword }) {
    const doc = {
      _id: `user:${couchdbUsername}`,
      type: 'user',
      provider,
      subject,
      email,
      name: name ?? null,
      picture: picture ?? null,
      couchdbUsername,
      couchdbPassword, // opaque long random; used by tricho-auth to mint sessions
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    };
    await this.#put(doc);
    return doc;
  }

  async touchUser(userDoc) {
    userDoc.lastSeenAt = Date.now();
    await this.#put(userDoc);
  }

  // ─── devices ────────────────────────────────────────────────────────────

  async listDevices(userId) {
    return this.#view('devices_by_user', { key: userId });
  }

  async findDevice(userId, deviceId) {
    const devs = await this.listDevices(userId);
    return devs.find((d) => d.deviceId === deviceId && !d.revoked) ?? null;
  }

  async addDevice({ userId, deviceId, name }) {
    const doc = {
      _id: `device:${userId}:${deviceId}`,
      type: 'device',
      userId,
      deviceId,
      name: name ?? 'Unknown device',
      addedAt: Date.now(),
      lastSeenAt: Date.now(),
      revoked: false,
    };
    await this.#put(doc);
    return doc;
  }

  async touchDevice(deviceDoc) {
    deviceDoc.lastSeenAt = Date.now();
    await this.#put(deviceDoc);
  }

  async revokeDevice(userId, deviceId) {
    const devs = await this.listDevices(userId);
    const device = devs.find((d) => d.deviceId === deviceId);
    if (!device) return false;
    device.revoked = true;
    device.revokedAt = Date.now();
    await this.#put(device);
    return true;
  }

  // ─── refresh tokens ─────────────────────────────────────────────────────

  async storeRefreshToken({ userId, deviceId, refreshToken, expiresAt }) {
    const hash = await sha256Hex(refreshToken);
    const doc = {
      _id: `token:${hash}`,
      type: 'token',
      tokenHash: hash,
      userId,
      deviceId,
      issuedAt: Date.now(),
      expiresAt,
      revoked: false,
    };
    await this.#put(doc);
    return doc;
  }

  async findRefreshToken(refreshToken) {
    const hash = await sha256Hex(refreshToken);
    const rows = await this.#view('tokens_by_hash', { key: hash });
    return rows[0] ?? null;
  }

  async revokeRefreshToken(tokenDoc) {
    tokenDoc.revoked = true;
    tokenDoc.revokedAt = Date.now();
    await this.#put(tokenDoc);
  }

  async revokeAllTokensForDevice(userId, deviceId) {
    const rows = await this.#view('tokens_by_hash');
    for (const row of rows) {
      if (row.userId === userId && row.deviceId === deviceId && !row.revoked) {
        row.revoked = true;
        row.revokedAt = Date.now();
        await this.#put(row);
      }
    }
  }

  // ─── subscriptions ──────────────────────────────────────────────────────

  async getSubscription(userId) {
    const rows = await this.#view('subscriptions_by_user', { key: userId });
    return rows[0] ?? null;
  }

  async ensureSubscription(userId, defaults) {
    const existing = await this.getSubscription(userId);
    if (existing) return existing;
    const now = Date.now();
    const doc = {
      _id: `subscription:${userId}`,
      type: 'subscription',
      userId,
      tier: defaults.tier ?? 'free',
      plan: defaults.plan ?? 'free',
      tierKey: defaults.tierKey ?? 'free',
      billingPeriod: defaults.billingPeriod ?? null,
      provider: defaults.provider ?? null,
      status: defaults.status ?? 'active',
      entitlements: defaults.entitlements ?? [],
      deviceLimit: defaults.deviceLimit ?? 1,
      backupRetentionMonths: defaults.backupRetentionMonths ?? 0,
      gracePeriodSeconds: defaults.gracePeriodSeconds ?? 7 * 86400,
      freeDeviceGrandfathered: defaults.freeDeviceGrandfathered ?? false,
      storageLimitMB: defaults.storageLimitMB ?? 500,
      paidUntil: defaults.paidUntil ?? null,
      stripeCustomerId: defaults.stripeCustomerId ?? null,
      stripeSubscriptionId: defaults.stripeSubscriptionId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.#put(doc);
    return doc;
  }

  /**
   * Persist a partial update to a subscription doc. Reads the latest revision,
   * merges the patch, writes. The patch may not change `_id`, `type`, or `userId`.
   */
  async updateSubscription(userId, patch) {
    const existing = await this.getSubscription(userId);
    if (!existing) throw new Error(`subscription not found: ${userId}`);
    const merged = {
      ...existing,
      ...patch,
      _id: existing._id,
      _rev: existing._rev,
      type: 'subscription',
      userId: existing.userId,
      updatedAt: Date.now(),
    };
    await this.#put(merged);
    return merged;
  }

  /**
   * Credit a paid period:
   *   paidUntil_new = max(now, paidUntil_old) + periodSeconds.
   * Sets entitlements to ["sync","backup"], status to "active", tierKey +
   * billingPeriod + deviceLimit + backupRetentionMonths derived from `plan`.
   * Does not record a payment-event by itself — the caller wraps this in a
   * recordPaymentEvent dedup check.
   */
  async creditPaidUntil({ userId, plan, periodSeconds, provider, deviceLimit, backupRetentionMonths, tierKey, billingPeriod, extra = {} }) {
    const existing = await this.getSubscription(userId);
    if (!existing) throw new Error(`subscription not found: ${userId}`);
    const now = Date.now();
    const baseMs = Math.max(now, existing.paidUntil ?? 0);
    const paidUntil = baseMs + periodSeconds * 1000;
    const patch = {
      tier: 'paid',
      plan,
      provider,
      status: 'active',
      entitlements: ['sync', 'backup'],
      paidUntil,
      ...extra,
    };
    if (tierKey != null) patch.tierKey = tierKey;
    if (billingPeriod != null) patch.billingPeriod = billingPeriod;
    if (deviceLimit != null) patch.deviceLimit = deviceLimit;
    if (backupRetentionMonths != null) patch.backupRetentionMonths = backupRetentionMonths;
    return this.updateSubscription(userId, patch);
  }

  // ─── payment-event dedup ────────────────────────────────────────────────

  async findPaymentEvent({ provider, eventId }) {
    const docId = `payment-event:${provider}:${eventId}`;
    return this.#get(docId);
  }

  /**
   * Idempotent insert. Returns `{ deduped: true }` if the event already
   * existed, `{ deduped: false, doc }` if it was newly created.
   */
  async recordPaymentEvent({ provider, eventId, payload = null }) {
    const docId = `payment-event:${provider}:${eventId}`;
    const existing = await this.#get(docId);
    if (existing) return { deduped: true };
    const now = Date.now();
    const doc = {
      _id: docId,
      type: 'payment-event',
      provider,
      eventId,
      payload,
      createdAt: now,
      expireAt: now + 30 * 86400 * 1000,
    };
    try {
      await this.#put(doc);
      return { deduped: false, doc };
    } catch (err) {
      // A concurrent writer beat us; the event is now recorded — treat as dedup.
      if (String(err?.message ?? '').includes('conflict')) return { deduped: true };
      throw err;
    }
  }

  async sweepExpiredPaymentEvents(now = Date.now()) {
    // Iterate via the dedicated view; CouchDB returns docs already.
    const rows = await this.#view('payment_events_by_id');
    let deleted = 0;
    for (const doc of rows) {
      if (doc.expireAt < now) {
        await this.#delete(doc._id, doc._rev).catch(() => null);
        deleted += 1;
      }
    }
    return { deleted };
  }

  // ─── payment intents (bank transfer) ────────────────────────────────────

  async findPaymentIntentByVS(vs) {
    const rows = await this.#view('payment_intents_by_vs', { key: vs });
    return rows[0] ?? null;
  }

  async getPaymentIntent(intentId) {
    return this.#get(`payment-intent:${intentId}`);
  }

  async createPaymentIntent(intent) {
    const doc = {
      _id: `payment-intent:${intent.intentId}`,
      type: 'payment-intent',
      ...intent,
    };
    await this.#put(doc);
    return doc;
  }

  async updatePaymentIntent(intentId, patch) {
    const existing = await this.getPaymentIntent(intentId);
    if (!existing) throw new Error(`payment intent not found: ${intentId}`);
    const merged = {
      ...existing,
      ...patch,
      _id: existing._id,
      _rev: existing._rev,
      type: 'payment-intent',
    };
    await this.#put(merged);
    return merged;
  }

  async listPaymentIntentsByUser(userId) {
    return this.#view('payment_intents_by_user', { key: userId });
  }

  async sweepExpiredPaymentIntents(now = Date.now()) {
    const rows = await this.#view('payment_intents_by_user');
    let updated = 0;
    for (const doc of rows) {
      if (doc.status === 'pending' && doc.expiresAt < now) {
        doc.status = 'expired';
        await this.#put(doc).catch(() => null);
        updated += 1;
      }
    }
    return { updated };
  }

  // ─── backup manifests ───────────────────────────────────────────────────

  async putBackupManifest(manifest) {
    const docId = `backup-manifest:${manifest.canonicalUsername}:${manifest.snapshotId}`;
    const existing = await this.#get(docId).catch(() => null);
    const doc = {
      _id: docId,
      type: 'backup-manifest',
      ...manifest,
    };
    if (existing) doc._rev = existing._rev;
    await this.#put(doc);
    return doc;
  }

  async listBackupManifests(canonicalUsername) {
    const rows = await this.#view('backup_manifests_by_user', {
      startkey: [canonicalUsername, 0],
      endkey: [canonicalUsername, {}],
    });
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getBackupManifest(canonicalUsername, snapshotId) {
    const docId = `backup-manifest:${canonicalUsername}:${snapshotId}`;
    return this.#get(docId);
  }

  async deleteBackupManifest(canonicalUsername, snapshotId) {
    const docId = `backup-manifest:${canonicalUsername}:${snapshotId}`;
    const existing = await this.#get(docId).catch(() => null);
    if (!existing) return false;
    await this.#delete(docId, existing._rev);
    return true;
  }

  // ─── monthly backups (one row per (user, YYYY-MM)) ─────────────────────

  async putMonthlyBackup(manifest) {
    const docId = `monthly-backup:${manifest.canonicalUsername}:${manifest.monthKey}`;
    const existing = await this.#get(docId).catch(() => null);
    const doc = {
      _id: docId,
      type: 'monthly-backup',
      ...manifest,
    };
    if (existing) doc._rev = existing._rev;
    await this.#put(doc);
    return doc;
  }

  async getMonthlyBackup(canonicalUsername, monthKey) {
    const docId = `monthly-backup:${canonicalUsername}:${monthKey}`;
    return this.#get(docId);
  }

  async listMonthlyBackups(canonicalUsername) {
    const rows = await this.#view('monthly_backups_by_user', {
      startkey: [canonicalUsername, ''],
      endkey: [canonicalUsername, '￿'],
    });
    return rows.sort((a, b) => (b.monthKey ?? '').localeCompare(a.monthKey ?? ''));
  }

  async deleteMonthlyBackup(canonicalUsername, monthKey) {
    const docId = `monthly-backup:${canonicalUsername}:${monthKey}`;
    const existing = await this.#get(docId).catch(() => null);
    if (!existing) return false;
    await this.#delete(docId, existing._rev);
    return true;
  }

  async listAllSubscriptions() {
    return this.#view('subscriptions_by_user');
  }

  // ─── CouchDB user management (outside tricho_meta) ──────────────────────

  async createCouchUser(username, password) {
    const docId = `org.couchdb.user:${username}`;
    const res = await fetch(
      `${this.couchdbUrl}/_users/${encodeURIComponent(docId)}`,
      {
        method: 'PUT',
        headers: { authorization: this.auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          _id: docId,
          name: username,
          password,
          roles: [],
          type: 'user',
        }),
      },
    );
    if (res.status === 201 || res.status === 202) return { created: true };
    if (res.status === 409) return { created: false }; // already exists
    const body = await res.text().catch(() => '');
    throw new Error(`createCouchUser failed (${res.status}): ${body}`);
  }
}
