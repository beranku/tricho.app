import { describe, it, expect } from 'vitest';
import { applyRetention } from '../billing/backup-store.mjs';

const DAY = 86400 * 1000;

function dailyManifests(count, startMs = 0) {
  // returns [oldest..newest]
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ snapshotId: `s_${i}`, createdAt: startMs + i * DAY });
  }
  return out;
}

describe('applyRetention', () => {
  it('keeps everything when below recent-N', () => {
    const m = dailyManifests(5);
    expect(applyRetention(m)).toEqual([]);
  });

  it('keeps the 7 newest + 1 monthly anchor', () => {
    // 14 daily backups across ~2 weeks; with default recentN=7 we keep
    // the 7 newest + the oldest (which is also the only month-anchor for
    // that month, depending on alignment). Result: at most 14-7 = 7 deleted,
    // minus any anchors retained.
    const m = dailyManifests(14);
    const deleted = applyRetention(m);
    // keep[].length >= 7 (the recentN guarantees this)
    const kept = m.length - deleted.length;
    expect(kept).toBeGreaterThanOrEqual(7);
    // The oldest is a monthly anchor in some calendar month, so usually
    // kept too.
    const oldestId = m[0].snapshotId;
    expect(deleted).not.toContain(oldestId);
  });

  it('preserves monthly anchors across the year', () => {
    // 20 monthly snapshots: oldest = 20 months ago, newest = today
    const now = Date.now();
    const monthly = [];
    for (let i = 0; i < 20; i++) {
      const t = now - i * 31 * DAY;
      monthly.push({ snapshotId: `m_${i}`, createdAt: t });
    }
    const deleted = applyRetention(monthly);
    // We keep recentN=7 newest (i=0..6) + up to 12 monthly anchors that
    // fall outside the recent-7. That's at most 7 + 12 = 19 kept; oldest
    // 1 may be pruned.
    const kept = monthly.length - deleted.length;
    expect(kept).toBeLessThanOrEqual(19);
    expect(kept).toBeGreaterThanOrEqual(12);
  });

  it('deterministic — running twice on same input picks same victims', () => {
    const m = dailyManifests(20);
    expect(applyRetention(m)).toEqual(applyRetention(m));
  });

  it('idempotent — after pruning, second call keeps everything', () => {
    const m = dailyManifests(20);
    const toDelete = new Set(applyRetention(m));
    const remaining = m.filter((x) => !toDelete.has(x.snapshotId));
    expect(applyRetention(remaining)).toEqual([]);
  });
});
