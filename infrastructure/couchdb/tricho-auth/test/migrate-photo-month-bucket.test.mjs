import { describe, it, expect } from 'vitest';
import { deriveMonthBucketFromUpdatedAt, runMigration } from '../scripts/migrate-photo-month-bucket.mjs';

describe('deriveMonthBucketFromUpdatedAt', () => {
  it('returns YYYY-MM in UTC', () => {
    expect(deriveMonthBucketFromUpdatedAt(Date.UTC(2026, 3, 15))).toBe('2026-04');
    expect(deriveMonthBucketFromUpdatedAt(Date.UTC(2024, 11, 31, 23, 59))).toBe('2024-12');
  });

  it('returns null for invalid input', () => {
    expect(deriveMonthBucketFromUpdatedAt(NaN)).toBeNull();
    expect(deriveMonthBucketFromUpdatedAt(undefined)).toBeNull();
    expect(deriveMonthBucketFromUpdatedAt('not a number')).toBeNull();
  });
});

describe('runMigration', () => {
  function fakeMetaWithDbs(dbs) {
    const writes = [];
    const fakeMeta = {
      couchdbUrl: 'http://fakecouch',
      auth: 'Basic fake',
    };
    const orig = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url);
      if (u.endsWith('/_all_dbs')) {
        return new Response(JSON.stringify(Object.keys(dbs)), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const dbMatch = u.match(/\/(userdb-[a-f0-9]+)\/_all_docs/);
      if (dbMatch) {
        const rows = dbs[dbMatch[1]] ?? [];
        return new Response(JSON.stringify({ rows: rows.map((doc) => ({ doc })) }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const putMatch = u.match(/\/(userdb-[a-f0-9]+)\/([^/?]+)$/);
      if (putMatch && (init?.method ?? 'GET') === 'PUT') {
        writes.push({ db: putMatch[1], id: decodeURIComponent(putMatch[2]), body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ ok: true, id: putMatch[2], rev: '2-x' }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    };
    return {
      meta: fakeMeta,
      writes,
      restore() { global.fetch = orig; },
    };
  }

  it('writes monthBucket for photo-meta docs missing it', async () => {
    const fixture = fakeMetaWithDbs({
      'userdb-abc': [
        { _id: 'photo-meta:1', _rev: '1-x', type: 'photo-meta', updatedAt: Date.UTC(2026, 3, 15) },
        { _id: 'photo-meta:2', _rev: '1-y', type: 'photo-meta', updatedAt: Date.UTC(2026, 4, 5) },
      ],
    });
    try {
      const r = await runMigration(fixture.meta);
      expect(r.dbs).toBe(1);
      expect(r.migrated).toBe(2);
      expect(fixture.writes.find((w) => w.id === 'photo-meta:1').body.monthBucket).toBe('2026-04');
      expect(fixture.writes.find((w) => w.id === 'photo-meta:2').body.monthBucket).toBe('2026-05');
    } finally {
      fixture.restore();
    }
  });

  it('skips docs that already have monthBucket', async () => {
    const fixture = fakeMetaWithDbs({
      'userdb-abc': [
        { _id: 'photo-meta:1', _rev: '1-x', type: 'photo-meta', updatedAt: 1, monthBucket: '2026-04' },
      ],
    });
    try {
      const r = await runMigration(fixture.meta);
      expect(r.migrated).toBe(0);
      expect(fixture.writes).toEqual([]);
    } finally {
      fixture.restore();
    }
  });

  it('skips non-photo docs', async () => {
    const fixture = fakeMetaWithDbs({
      'userdb-abc': [
        { _id: 'customer:1', _rev: '1-x', type: 'customer', updatedAt: 1 },
        { _id: 'visit:1', _rev: '1-x', type: 'visit', updatedAt: 1 },
      ],
    });
    try {
      const r = await runMigration(fixture.meta);
      expect(r.migrated).toBe(0);
    } finally {
      fixture.restore();
    }
  });

  it('idempotent — second run is a no-op', async () => {
    const fixture = fakeMetaWithDbs({
      'userdb-abc': [
        { _id: 'photo-meta:1', _rev: '1-x', type: 'photo-meta', updatedAt: Date.UTC(2026, 3, 15) },
      ],
    });
    try {
      await runMigration(fixture.meta);
      const writeCountAfterFirst = fixture.writes.length;
      // Mark the doc with monthBucket as if first migration succeeded.
      const dbsAfter = {
        'userdb-abc': [
          { _id: 'photo-meta:1', _rev: '2-x', type: 'photo-meta', updatedAt: Date.UTC(2026, 3, 15), monthBucket: '2026-04' },
        ],
      };
      fixture.restore();
      const fixture2 = fakeMetaWithDbs(dbsAfter);
      try {
        const r = await runMigration(fixture2.meta);
        expect(r.migrated).toBe(0);
      } finally {
        fixture2.restore();
      }
    } finally {
      // already restored
    }
  });
});
