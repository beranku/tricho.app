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
    const doc = {
      _id: `subscription:${userId}`,
      type: 'subscription',
      userId,
      tier: defaults.tier ?? 'free',
      deviceLimit: defaults.deviceLimit ?? 2,
      storageLimitMB: defaults.storageLimitMB ?? 500,
      paidUntil: null,
      updatedAt: Date.now(),
    };
    await this.#put(doc);
    return doc;
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
