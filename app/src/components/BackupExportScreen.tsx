import React, { useEffect, useMemo, useState } from 'react';
import { m } from '../i18n';
import type { VaultDb } from '../db/pouch';
import { generateLocalBackupZip, triggerBlobDownload } from '../backup/local-zip';
import { formatUtcMonth, isValidMonthKey } from '../lib/format/utc-month';

export interface BackupExportScreenProps {
  db: VaultDb;
  vaultId: string;
  onBack: () => void;
}

interface MonthOption {
  monthKey: string;
  label: string;
  count: number;
}

export function BackupExportScreen({ db, vaultId, onBack }: BackupExportScreenProps): JSX.Element {
  const [months, setMonths] = useState<MonthOption[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await db.pouch.allDocs<Record<string, unknown>>({
          include_docs: true,
          attachments: false,
        } as never);
        const buckets = new Map<string, number>();
        for (const row of all.rows) {
          const doc = row.doc as Record<string, unknown> | undefined;
          if (!doc) continue;
          if (typeof doc._id === 'string' && doc._id.startsWith('_local/')) continue;
          if (doc.type === 'photo-meta') {
            const bucket = typeof doc.monthBucket === 'string' && isValidMonthKey(doc.monthBucket)
              ? doc.monthBucket
              : typeof doc.updatedAt === 'number'
                ? formatUtcMonth(doc.updatedAt)
                : null;
            if (bucket) buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
          }
        }
        // Always offer the current month even if there are no photos yet (text data still backs up).
        const currentMonth = formatUtcMonth(Date.now());
        if (!buckets.has(currentMonth)) buckets.set(currentMonth, 0);
        const opts = [...buckets.entries()]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([monthKey, count]) => ({ monthKey, label: monthKey, count }));
        if (cancelled) return;
        setMonths(opts);
        setSelected(opts[0]?.monthKey ?? null);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  const onDownload = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const result = await generateLocalBackupZip({ db, vaultId, monthKey: selected });
      triggerBlobDownload(result.blob, result.filename);
      // Stash the timestamp so Settings can show "Last backed up X days ago".
      // `_local/` doc, not replicated, plaintext (timestamp is not sensitive).
      try {
        const existing = (await db.pouch
          .get('_local/last-backup')
          .catch(() => null)) as { _rev?: string } | null;
        const next: { _id: string; _rev?: string; at: number; monthKey: string } = {
          _id: '_local/last-backup',
          at: Date.now(),
          monthKey: selected,
        };
        if (existing?._rev) next._rev = existing._rev;
        await db.pouch.put(next as never);
      } catch (err) {
        console.warn('[BackupExportScreen] failed to stash _local/last-backup', err);
      }
      setDone(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const selectedOption = useMemo(
    () => months?.find((m) => m.monthKey === selected) ?? null,
    [months, selected],
  );

  return (
    <section style={containerStyle} aria-labelledby="backup-export-title">
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onBack} style={iconBtnStyle} aria-label={m.billing_back()}>←</button>
        <h2 id="backup-export-title" style={{ margin: 0 }}>{m.plan_localBackup_title()}</h2>
      </header>

      <p style={{ margin: 0, color: '#555', fontSize: 14 }}>{m.plan_localBackup_blurb()}</p>

      {months == null ? (
        <p style={{ color: '#888' }}>…</p>
      ) : months.length === 0 ? (
        <p style={{ color: '#888' }}>{m.plan_localBackup_empty()}</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <label htmlFor="month-picker" style={{ fontSize: 13, color: '#555' }}>
            {m.plan_localBackup_pickMonth()}
          </label>
          <select
            id="month-picker"
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value)}
            disabled={busy}
            style={selectStyle}
          >
            {months.map((opt) => (
              <option key={opt.monthKey} value={opt.monthKey}>
                {opt.label} {opt.count > 0 ? `· ${opt.count} 📷` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <button onClick={onDownload} disabled={busy || !selectedOption} style={primaryBtnStyle}>
        {busy ? m.plan_localBackup_generating() : m.plan_localBackup_download()}
      </button>

      {done && <p role="status" style={{ color: '#34c759', fontSize: 13 }}>{m.plan_localBackup_done()}</p>}
      {error && <p role="alert" style={{ color: '#ff3b30', fontSize: 13 }}>{error}</p>}
    </section>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'grid', gap: 16, padding: 16, maxWidth: 480, margin: '0 auto',
};
const selectStyle: React.CSSProperties = {
  padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)',
  background: '#fff', fontSize: 14,
};
const primaryBtnStyle: React.CSSProperties = {
  padding: '12px 16px', borderRadius: 10, border: 'none',
  background: '#007aff', color: '#fff', cursor: 'pointer', fontSize: 15,
};
const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 8, cursor: 'pointer', fontSize: 18,
};
