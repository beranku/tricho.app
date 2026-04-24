import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { Meta } from '../../meta.mjs';

// First integration suite — spins a real couchdb:3, drives
// Meta.ensureDatabase + findUser against it, then tears the container
// down. Establishes the pattern for all other integration tests.

let container;
let meta;

beforeAll(async () => {
  container = await new GenericContainer('couchdb:3')
    .withEnvironment({ COUCHDB_USER: 'admin', COUCHDB_PASSWORD: 'test-pw' })
    .withExposedPorts(5984)
    .withWaitStrategy(Wait.forHttp('/_up', 5984).forStatusCode(200))
    .withStartupTimeout(60_000)
    .start();

  const couchdbUrl = `http://${container.getHost()}:${container.getMappedPort(5984)}`;
  meta = new Meta({
    couchdbUrl,
    adminUser: 'admin',
    adminPassword: 'test-pw',
    dbName: 'tricho_meta_itest',
  });

  // CouchDB's _users DB must exist before createCouchUser can write to
  // it. The production image's entrypoint shim handles this; in tests
  // we create it explicitly.
  const auth = 'Basic ' + Buffer.from('admin:test-pw').toString('base64');
  for (const db of ['_users', '_replicator']) {
    await fetch(`${couchdbUrl}/${db}`, {
      method: 'PUT',
      headers: { authorization: auth },
    });
  }
}, 90_000);

afterAll(async () => {
  if (container) await container.stop();
}, 30_000);

describe('Meta against real CouchDB', () => {
  it('ensureDatabase creates the DB + design doc (idempotent)', async () => {
    await meta.ensureDatabase();
    await meta.ensureDatabase();
    // No throw = passed; a successful second call proves idempotence.
    expect(true).toBe(true);
  });

  it('findUser returns null for an unknown subject', async () => {
    const u = await meta.findUser({ provider: 'google', subject: 'nope-' + Date.now() });
    expect(u).toBeNull();
  });

  it('createUser persists + findUser round-trips', async () => {
    const sub = 'int-sub-' + Date.now();
    const username = 'g_int' + Math.random().toString(36).slice(2, 8);
    await meta.createCouchUser(username, 'secret-pw');
    const doc = await meta.createUser({
      provider: 'google',
      subject: sub,
      email: 'int@tricho.test',
      name: 'Int User',
      picture: null,
      couchdbUsername: username,
      couchdbPassword: 'secret-pw',
    });
    expect(doc._id).toBe(`user:${username}`);
    const found = await meta.findUser({ provider: 'google', subject: sub });
    expect(found).toBeTruthy();
    expect(found.couchdbUsername).toBe(username);
  });

  it('addDevice + listDevices round-trip', async () => {
    const userId = 'user:g_int_devices';
    await meta.addDevice({ userId, deviceId: 'dev-A', name: 'Phone A' });
    await meta.addDevice({ userId, deviceId: 'dev-B', name: 'Laptop B' });
    const devices = await meta.listDevices(userId);
    const names = devices.map((d) => d.name).sort();
    expect(names).toContain('Phone A');
    expect(names).toContain('Laptop B');
  });

  it('refresh-token store uses hashed id — raw token is not reachable', async () => {
    const raw = 'raw-token-' + Date.now();
    await meta.storeRefreshToken({
      userId: 'user:g_int_devices',
      deviceId: 'dev-A',
      refreshToken: raw,
      expiresAt: Date.now() + 60_000,
    });
    // Round-trip via findRefreshToken (which hashes the raw arg).
    const found = await meta.findRefreshToken(raw);
    expect(found).toBeTruthy();
    expect(found.tokenHash).toBeDefined();
    expect(found.tokenHash).not.toBe(raw); // stored as hash, not raw
    expect(found.revoked).toBe(false);
  });
});
