import { describe, it, expect } from 'vitest';
import {
  computeMonthlyBackup,
  applyMonthlyRetention,
  couchUsernameToDbName,
} from '../billing/backup-snapshot.mjs';

const CANONICAL = 'g_abc';

function fakeDoc(opts) {
  return {
    _id: opts._id,
    _rev: '1-x',
    type: opts.type,
    updatedAt: opts.updatedAt ?? Date.now(),
    deleted: Boolean(opts.deleted),
    payload: { ct: 'X', iv: 'Y' },
    ...(opts.monthBucket ? { monthBucket: opts.monthBucket } : {}),
    ...(opts._attachments ? { _attachments: opts._attachments } : {}),
  };
}

function fakeAttachment(byteValue, length = 8) {
  const buf = Buffer.alloc(length, byteValue);
  return { content_type: 'application/octet-stream', data: buf.toString('base64') };
}

function fakeMetaWith(rows) {
  return {
    couchdbUrl: 'http://fakecouch',
    auth: 'Basic fake',
    rows,
  };
}

// Patch global fetch so the snapshot module reads from our fake.
function withFakeFetch(rows, run) {
  const original = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('_all_docs')) {
      return new Response(JSON.stringify({ rows: rows.map((doc) => ({ doc })) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  };
  return Promise.resolve(run()).finally(() => {
    global.fetch = original;
  });
}

describe('computeMonthlyBackup', () => {
  it('produces a deterministic ZIP given fixed inputs', async () => {
    const meta = fakeMetaWith([]);
    const docs = [
      fakeDoc({ _id: 'customer:1', type: 'customer', updatedAt: 100 }),
      fakeDoc({
        _id: 'photo-meta:p1',
        type: 'photo-meta',
        monthBucket: '2026-04',
        _attachments: { blob: fakeAttachment(0xa0, 4) },
      }),
    ];
    const a = await withFakeFetch(docs, () =>
      computeMonthlyBackup({ meta, canonicalUsername: CANONICAL, monthKey: '2026-04', now: 1000 }),
    );
    const b = await withFakeFetch(docs, () =>
      computeMonthlyBackup({ meta, canonicalUsername: CANONICAL, monthKey: '2026-04', now: 1000 }),
    );
    expect(Buffer.from(a.bytes).toString('hex')).toEqual(Buffer.from(b.bytes).toString('hex'));
  });

  it('filters photo-meta docs by monthBucket', async () => {
    const meta = fakeMetaWith([]);
    const docs = [
      fakeDoc({ _id: 'customer:1', type: 'customer' }),
      fakeDoc({ _id: 'photo-meta:apr', type: 'photo-meta', monthBucket: '2026-04' }),
      fakeDoc({ _id: 'photo-meta:may', type: 'photo-meta', monthBucket: '2026-05' }),
    ];
    const result = await withFakeFetch(docs, () =>
      computeMonthlyBackup({ meta, canonicalUsername: CANONICAL, monthKey: '2026-04' }),
    );
    expect(result.docCount).toBe(1); // only customer
    expect(result.photoCount).toBe(1); // only april
  });

  it('falls back to updatedAt month for legacy photo docs missing monthBucket', async () => {
    const meta = fakeMetaWith([]);
    const aprilTs = Date.UTC(2026, 3, 15);
    const docs = [fakeDoc({ _id: 'photo-meta:legacy', type: 'photo-meta', updatedAt: aprilTs })];
    const result = await withFakeFetch(docs, () =>
      computeMonthlyBackup({ meta, canonicalUsername: CANONICAL, monthKey: '2026-04' }),
    );
    expect(result.photoCount).toBe(1);
  });

  it('skips _local/ and _design/ docs', async () => {
    const meta = fakeMetaWith([]);
    const docs = [
      fakeDoc({ _id: '_local/skip', type: 'local-thing' }),
      fakeDoc({ _id: '_design/foo', type: 'design' }),
      fakeDoc({ _id: 'customer:1', type: 'customer' }),
    ];
    const result = await withFakeFetch(docs, () =>
      computeMonthlyBackup({ meta, canonicalUsername: CANONICAL, monthKey: '2026-04' }),
    );
    expect(result.docCount).toBe(1);
  });

  it('passes attachment bytes through unchanged (bytes-as-is invariant)', async () => {
    const meta = fakeMetaWith([]);
    const photoDoc = fakeDoc({
      _id: 'photo-meta:1',
      type: 'photo-meta',
      monthBucket: '2026-04',
      _attachments: { blob: fakeAttachment(0xab, 16) },
    });
    const result = await withFakeFetch([photoDoc], () =>
      computeMonthlyBackup({ meta, canonicalUsername: CANONICAL, monthKey: '2026-04' }),
    );
    expect(result.attachmentCount).toBe(1);
    // Unzip and confirm exact bytes.
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(result.bytes);
    const att = zip.file('attachments/photo-meta:1/blob.bin');
    expect(att).toBeTruthy();
    const out = await att.async('uint8array');
    const expected = Buffer.alloc(16, 0xab);
    expect(Buffer.from(out).equals(expected)).toBe(true);
  });

  it('rejects malformed monthKey', async () => {
    const meta = fakeMetaWith([]);
    await expect(
      computeMonthlyBackup({ meta, canonicalUsername: CANONICAL, monthKey: 'invalid' }),
    ).rejects.toThrow();
  });
});

describe('applyMonthlyRetention', () => {
  it('keeps N newest months', () => {
    const m = ['2026-04', '2026-03', '2026-02', '2026-01', '2025-12'].map((monthKey) => ({ monthKey }));
    const toDelete = applyMonthlyRetention(m, 3);
    expect(toDelete.sort()).toEqual(['2025-12', '2026-01']);
  });

  it('returns all if retention is 0', () => {
    const m = ['2026-04'].map((monthKey) => ({ monthKey }));
    expect(applyMonthlyRetention(m, 0)).toEqual(['2026-04']);
  });

  it('returns empty when within retention', () => {
    const m = ['2026-04', '2026-03'].map((monthKey) => ({ monthKey }));
    expect(applyMonthlyRetention(m, 12)).toEqual([]);
  });
});

describe('couchUsernameToDbName', () => {
  it('produces userdb-<hex>', () => {
    const name = couchUsernameToDbName('g_abc');
    expect(name.startsWith('userdb-')).toBe(true);
    expect(name).toBe(
      'userdb-' + Buffer.from('g_abc', 'utf8').toString('hex'),
    );
  });
});
