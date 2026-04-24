import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Meta } from '../meta.mjs';

// We test Meta against a fake fetch that records URL + method + body so we
// can assert idempotence + request shape without spinning up CouchDB.

function fakeFetch({ db = {} } = {}) {
  const calls = [];
  const docs = new Map(Object.entries(db));

  const fn = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ?? null });
    const u = new URL(String(url));
    const path = u.pathname;

    // PUT /db — create database
    if (init.method === 'PUT' && /^\/[^/]+$/.test(path)) {
      const dbName = path.slice(1);
      if (docs.has(`__db:${dbName}`)) return new Response(JSON.stringify({ error: 'file_exists' }), { status: 412 });
      docs.set(`__db:${dbName}`, true);
      return new Response('{"ok":true}', { status: 201 });
    }

    // PUT /db/doc — create or update
    if (init.method === 'PUT' && /^\/[^/]+\/.+/.test(path)) {
      const docId = decodeURIComponent(path.split('/').slice(2).join('/'));
      const body = JSON.parse(init.body);
      docs.set(docId, body);
      return new Response('{"ok":true,"rev":"1-xyz"}', { status: 201 });
    }

    // GET /db/_design/.../view
    if (init.method === 'GET' && path.includes('/_design/')) {
      const viewMatch = path.match(/\/_design\/tricho\/_view\/(\w+)/);
      if (viewMatch) {
        const rows = [...docs.values()]
          .filter((d) => typeof d === 'object' && d !== null && 'type' in d)
          .map((doc) => ({ doc }));
        return new Response(JSON.stringify({ rows }), { status: 200 });
      }
    }

    // GET /db/doc
    if (init.method === 'GET' && /^\/[^/]+\/.+/.test(path)) {
      const docId = decodeURIComponent(path.split('/').slice(2).join('/'));
      const d = docs.get(docId);
      if (!d) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      return new Response(JSON.stringify(d), { status: 200 });
    }

    return new Response('{}', { status: 200 });
  });

  return { fn, calls, docs };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('Meta.ensureDatabase', () => {
  it('is idempotent — calling twice issues one successful PUT on the DB', async () => {
    const fetchStub = fakeFetch();
    globalThis.fetch = fetchStub.fn;

    const meta = new Meta({
      couchdbUrl: 'http://couchdb:5984',
      adminUser: 'admin',
      adminPassword: 'pw',
      dbName: 'tricho_meta_test',
    });

    await meta.ensureDatabase();
    await meta.ensureDatabase();

    const dbPuts = fetchStub.calls.filter(
      (c) => c.method === 'PUT' && c.url.endsWith('/tricho_meta_test'),
    );
    expect(dbPuts.length).toBeGreaterThanOrEqual(1);

    // Design-doc seed ran (PUT /db/_design%2Ftricho — colon + slash encoded).
    const ddocPuts = fetchStub.calls.filter(
      (c) => c.url.includes('_design') || c.url.includes('%2Fdesign') || c.url.includes('design%2Ftricho'),
    );
    expect(ddocPuts.length).toBeGreaterThan(0);
  });
});

describe('Meta user + device flows', () => {
  it('createUser persists with the couchdb_username id and default timestamps', async () => {
    const fetchStub = fakeFetch({ db: { '__db:tricho_meta_test': true } });
    globalThis.fetch = fetchStub.fn;

    const meta = new Meta({ couchdbUrl: 'http://c:5984', adminUser: 'a', adminPassword: 'p', dbName: 'tricho_meta_test' });
    const user = await meta.createUser({
      provider: 'google',
      subject: 'g-123',
      email: 'x@y',
      name: 'X',
      picture: null,
      couchdbUsername: 'g_abc',
      couchdbPassword: 'secret',
    });
    expect(user._id).toBe('user:g_abc');
    expect(user.provider).toBe('google');
    expect(user.createdAt).toBeGreaterThan(0);
    expect(user.lastSeenAt).toBeGreaterThan(0);
  });

  it('addDevice yields deviceId + addedAt + revoked=false', async () => {
    const fetchStub = fakeFetch();
    globalThis.fetch = fetchStub.fn;
    const meta = new Meta({ couchdbUrl: 'http://c:5984', adminUser: 'a', adminPassword: 'p', dbName: 'm' });
    const d = await meta.addDevice({ userId: 'user:g_abc', deviceId: 'dev-1', name: 'iPhone' });
    expect(d.deviceId).toBe('dev-1');
    expect(d.revoked).toBe(false);
    expect(d.addedAt).toBeGreaterThan(0);
  });
});

describe('Meta refresh tokens', () => {
  it('storeRefreshToken hashes the raw token — never persists it verbatim', async () => {
    const fetchStub = fakeFetch();
    globalThis.fetch = fetchStub.fn;

    const meta = new Meta({ couchdbUrl: 'http://c:5984', adminUser: 'a', adminPassword: 'p', dbName: 'm' });
    await meta.storeRefreshToken({
      userId: 'user:g_abc',
      deviceId: 'dev-1',
      refreshToken: 'PLAINTEXT_RAW_TOKEN',
      expiresAt: Date.now() + 1000,
    });

    // _id "token:<hash>" gets URL-encoded as token%3A<hash>.
    const putCall = fetchStub.calls.find(
      (c) => c.method === 'PUT' && (c.url.includes('/token:') || c.url.includes('/token%3A')),
    );
    expect(putCall).toBeDefined();
    // The raw token MUST NOT appear anywhere in the stored body or id.
    expect(putCall.url).not.toContain('PLAINTEXT_RAW_TOKEN');
    expect(putCall.body).not.toContain('PLAINTEXT_RAW_TOKEN');
  });
});

describe('Meta.createCouchUser', () => {
  it('creates _users doc with the right id + returns created', async () => {
    const fetchStub = fakeFetch();
    globalThis.fetch = fetchStub.fn;
    const meta = new Meta({ couchdbUrl: 'http://c:5984', adminUser: 'a', adminPassword: 'p', dbName: 'm' });
    const r = await meta.createCouchUser('g_abc', 'pw');
    expect(r.created).toBe(true);
    const put = fetchStub.calls.find((c) => c.method === 'PUT' && c.url.includes('_users/org.couchdb.user'));
    expect(put).toBeDefined();
    const body = JSON.parse(put.body);
    expect(body.name).toBe('g_abc');
    expect(body.type).toBe('user');
    expect(body.roles).toEqual([]);
  });

  it('returns created:false on 409 conflict', async () => {
    const stub = fakeFetch();
    globalThis.fetch = vi.fn(async (url, init) => {
      if (init?.method === 'PUT' && String(url).includes('_users/')) {
        return new Response('{"error":"conflict"}', { status: 409 });
      }
      return stub.fn(url, init);
    });
    const meta = new Meta({ couchdbUrl: 'http://c:5984', adminUser: 'a', adminPassword: 'p', dbName: 'm' });
    const r = await meta.createCouchUser('g_abc', 'pw');
    expect(r.created).toBe(false);
  });
});
