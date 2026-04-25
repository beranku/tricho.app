// Daily cron that snapshots each paid user's userdb-* into a monthly ZIP.
//
// Invocation cadence: every BACKUP_CRON_INTERVAL_HOURS hours (default 24).
// Each run:
//   1. List all paid subscriptions.
//   2. For each: compute the monthly backup ZIP for the *current* month
//      (overwrite-in-place "draft" snapshot).
//   3. On the first run of a new calendar month, additionally finalize the
//      previous month (re-compute one last time and flag `finalized: true`).
//   4. Apply retention based on `subscription.backupRetentionMonths`.
//
// Idempotent — repeated runs with the same `now` produce the same state.
// Bytes-as-is invariant: the cron never touches plaintext.

import { computeMonthlyBackup, applyMonthlyRetention } from './backup-snapshot.mjs';
import { BackupStore } from './backup-store.mjs';

function utcMonthKey(now) {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function previousUtcMonthKey(now) {
  const d = new Date(now);
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 1);
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isFirstDayOfMonth(now) {
  return new Date(now).getUTCDate() === 1;
}

/**
 * Run one pass of the cron. Pure-ish: side effects are only writes to
 * filesystem (BackupStore) and meta DB; no clocks, no networks beyond
 * `meta` admin reads + `BackupStore` writes.
 *
 * @param {{ meta: any, env: Record<string, string|undefined>, now?: number }} args
 */
export async function runBackupCron({ meta, env, now = Date.now() }) {
  if (!env.BACKUP_ROOT) {
    return { skipped: 'no_backup_root', usersProcessed: 0 };
  }
  const store = new BackupStore({ root: env.BACKUP_ROOT });
  const subs = await meta.listAllSubscriptions();
  const currentMonth = utcMonthKey(now);
  const finalizePrevMonth = isFirstDayOfMonth(now);
  const prevMonth = previousUtcMonthKey(now);
  let processed = 0;
  const errors = [];

  for (const sub of subs) {
    if (sub?.tier !== 'paid') continue;
    const canonicalUsername = String(sub.userId ?? '').replace(/^user:/, '');
    if (!canonicalUsername) continue;
    try {
      // 1. Current-month draft snapshot (always re-compute, overwrite).
      await snapshotMonth({ meta, store, canonicalUsername, monthKey: currentMonth, now, finalized: false });

      // 2. On the 1st: finalize the previous month (last update, then mark final).
      if (finalizePrevMonth) {
        await snapshotMonth({ meta, store, canonicalUsername, monthKey: prevMonth, now, finalized: true });
      }

      // 3. Apply retention.
      const retentionMonths = sub.backupRetentionMonths ?? 0;
      const all = await meta.listMonthlyBackups(canonicalUsername);
      const toDelete = applyMonthlyRetention(all, retentionMonths);
      for (const mk of toDelete) {
        await store.deleteMonth({ canonicalUsername, monthKey: mk }).catch(() => null);
        await meta.deleteMonthlyBackup(canonicalUsername, mk).catch(() => null);
      }

      processed += 1;
    } catch (err) {
      errors.push({ canonicalUsername, message: err?.message ?? String(err) });
    }
  }
  return { usersProcessed: processed, errors };
}

async function snapshotMonth({ meta, store, canonicalUsername, monthKey, now, finalized }) {
  const result = await computeMonthlyBackup({ meta, canonicalUsername, monthKey, now });
  await store.writeMonth({ canonicalUsername, monthKey, bytes: Buffer.from(result.bytes) });
  await meta.putMonthlyBackup({
    canonicalUsername,
    monthKey,
    sizeBytes: result.bytes.length,
    docCount: result.docCount,
    photoCount: result.photoCount,
    attachmentCount: result.attachmentCount,
    finalized,
    generatedAt: now,
    updatedAt: now,
  });
}
