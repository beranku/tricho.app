import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBackupCron } from '../billing/backup-cron.mjs';
import { fakeMeta } from './fixtures/meta.mjs';

function withFakeFetch(rowsByDb, run) {
  const original = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    const m = u.match(/userdb-([a-f0-9]+)/);
    if (m && u.includes('_all_docs')) {
      const dbHex = m[1];
      const rows = rowsByDb[dbHex] ?? [];
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

function fakeDoc(opts) {
  return {
    _id: opts._id,
    _rev: '1-x',
    type: opts.type,
    updatedAt: opts.updatedAt ?? Date.now(),
    deleted: false,
    payload: { ct: 'X', iv: 'Y' },
    ...(opts.monthBucket ? { monthBucket: opts.monthBucket } : {}),
  };
}

function makeBackupRoot() {
  return mkdtempSync(join(tmpdir(), 'tricho-backup-cron-'));
}

function setupPaidUser(meta, state, opts = {}) {
  const userId = 'user:g_abc';
  state.subs.set(userId, {
    _id: 'subscription:user:g_abc',
    type: 'subscription',
    userId,
    tier: 'paid',
    plan: 'pro-monthly',
    tierKey: 'pro',
    billingPeriod: 'month',
    provider: 'stripe',
    status: 'active',
    entitlements: ['sync', 'backup'],
    deviceLimit: 2,
    backupRetentionMonths: opts.retentionMonths ?? 12,
    paidUntil: Date.now() + 30 * 86400 * 1000,
  });
}

describe('runBackupCron', () => {
  it('produces a current-month draft backup for a paid user', async () => {
    const root = makeBackupRoot();
    try {
      const { meta, state } = fakeMeta();
      setupPaidUser(meta, state);
      const dbHex = Buffer.from('g_abc', 'utf8').toString('hex');
      const rows = {
        [dbHex]: [
          fakeDoc({ _id: 'customer:1', type: 'customer' }),
          fakeDoc({ _id: 'photo-meta:p1', type: 'photo-meta', monthBucket: '2026-04' }),
        ],
      };
      const now = Date.UTC(2026, 3, 15); // April 15 2026
      const r = await withFakeFetch(rows, () =>
        runBackupCron({ meta, env: { BACKUP_ROOT: root }, now }),
      );
      expect(r.usersProcessed).toBe(1);
      const months = await meta.listMonthlyBackups('g_abc');
      expect(months).toHaveLength(1);
      expect(months[0].monthKey).toBe('2026-04');
      expect(months[0].finalized).toBe(false);
      expect(months[0].sizeBytes).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finalizes previous month on the 1st day of new month', async () => {
    const root = makeBackupRoot();
    try {
      const { meta, state } = fakeMeta();
      setupPaidUser(meta, state);
      const dbHex = Buffer.from('g_abc', 'utf8').toString('hex');
      const rows = { [dbHex]: [fakeDoc({ _id: 'customer:1', type: 'customer' })] };
      const now = Date.UTC(2026, 4, 1); // May 1 2026
      await withFakeFetch(rows, () =>
        runBackupCron({ meta, env: { BACKUP_ROOT: root }, now }),
      );
      const months = await meta.listMonthlyBackups('g_abc');
      const map = Object.fromEntries(months.map((m) => [m.monthKey, m]));
      expect(map['2026-05']).toBeDefined();
      expect(map['2026-04']).toBeDefined();
      expect(map['2026-04'].finalized).toBe(true);
      expect(map['2026-05'].finalized).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips free users', async () => {
    const root = makeBackupRoot();
    try {
      const { meta, state } = fakeMeta();
      state.subs.set('user:g_free', {
        _id: 'subscription:user:g_free',
        type: 'subscription',
        userId: 'user:g_free',
        tier: 'free',
        backupRetentionMonths: 0,
      });
      const r = await withFakeFetch({}, () =>
        runBackupCron({ meta, env: { BACKUP_ROOT: root }, now: Date.UTC(2026, 3, 15) }),
      );
      expect(r.usersProcessed).toBe(0);
      expect(await meta.listMonthlyBackups('g_free')).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('applies retention and prunes old months', async () => {
    const root = makeBackupRoot();
    try {
      const { meta, state } = fakeMeta();
      setupPaidUser(meta, state, { retentionMonths: 2 });
      // Pre-populate 4 months of manifests + backup files.
      for (const monthKey of ['2026-01', '2026-02', '2026-03', '2026-04']) {
        await meta.putMonthlyBackup({
          canonicalUsername: 'g_abc',
          monthKey,
          sizeBytes: 100,
          finalized: true,
          docCount: 1,
          photoCount: 0,
          generatedAt: 1,
        });
      }
      const dbHex = Buffer.from('g_abc', 'utf8').toString('hex');
      const rows = { [dbHex]: [fakeDoc({ _id: 'customer:1', type: 'customer' })] };
      // Run cron in late April → currentMonth is 2026-04. After retention=2,
      // we keep only 2 newest months (2026-04 and 2026-03), prune the rest.
      const now = Date.UTC(2026, 3, 15);
      await withFakeFetch(rows, () =>
        runBackupCron({ meta, env: { BACKUP_ROOT: root }, now }),
      );
      const after = await meta.listMonthlyBackups('g_abc');
      const keys = after.map((m) => m.monthKey).sort();
      expect(keys).toEqual(['2026-03', '2026-04']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('idempotent — second run with same now does not double up', async () => {
    const root = makeBackupRoot();
    try {
      const { meta, state } = fakeMeta();
      setupPaidUser(meta, state);
      const dbHex = Buffer.from('g_abc', 'utf8').toString('hex');
      const rows = { [dbHex]: [fakeDoc({ _id: 'customer:1', type: 'customer' })] };
      const now = Date.UTC(2026, 3, 15);
      await withFakeFetch(rows, () => runBackupCron({ meta, env: { BACKUP_ROOT: root }, now }));
      const first = await meta.listMonthlyBackups('g_abc');
      await withFakeFetch(rows, () => runBackupCron({ meta, env: { BACKUP_ROOT: root }, now }));
      const second = await meta.listMonthlyBackups('g_abc');
      expect(second).toHaveLength(first.length);
      expect(second[0].monthKey).toBe(first[0].monthKey);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips when BACKUP_ROOT is missing', async () => {
    const { meta } = fakeMeta();
    const r = await runBackupCron({ meta, env: {}, now: 0 });
    expect(r.skipped).toBe('no_backup_root');
  });
});
