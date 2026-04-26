import React, { useState } from 'react';
import { m } from '../i18n';
import type { VaultDb } from '../db/pouch';
import { restoreFromZipBytes, readZipFromFile, VaultIdMismatchError } from '../backup/local-zip-restore';
import { IncompatibleBackupVersionError, MalformedBackupError } from '../backup/zip-pack';

export interface RestoreFromZipScreenProps {
  db: VaultDb;
  expectedVaultId?: string;
  onBack: () => void;
  onRestored: (summary: { applied: number; monthKey: string }) => void;
}

export function RestoreFromZipScreen({ db, expectedVaultId, onBack, onRestored }: RestoreFromZipScreenProps): JSX.Element {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ applied: number; monthKey: string } | null>(null);

  const onFilesPicked = (chosen: FileList | null) => {
    if (!chosen) return;
    const arr = Array.from(chosen).filter((f) => f.name.endsWith('.zip') || f.name.endsWith('.tricho-backup.zip'));
    setFiles(arr);
    setError(null);
  };

  const onRestore = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    let totalApplied = 0;
    let lastMonthKey = '';
    try {
      for (const file of files) {
        const bytes = await readZipFromFile(file);
        const report = await restoreFromZipBytes({ db, bytes, expectedVaultId });
        totalApplied += report.appliedDocs + report.appliedPhotos;
        lastMonthKey = report.manifest.monthKey;
      }
      const summary = { applied: totalApplied, monthKey: lastMonthKey };
      setSuccess(summary);
      onRestored(summary);
    } catch (err) {
      if (err instanceof IncompatibleBackupVersionError) setError(m.restore_zip_error_version());
      else if (err instanceof MalformedBackupError) setError(m.restore_zip_error_invalid());
      else if (err instanceof VaultIdMismatchError) setError(m.restore_zip_error_vault());
      else setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={containerStyle} aria-labelledby="restore-zip-title">
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onBack} style={iconBtnStyle} aria-label={m.billing_back()}>←</button>
        <h2 id="restore-zip-title" style={{ margin: 0 }}>{m.restore_zip_title()}</h2>
      </header>

      <p style={{ margin: 0, color: '#555', fontSize: 14 }}>
        {m.restore_zip_blurb({ filename: '*.tricho-backup.zip' })}
      </p>

      <input
        type="file"
        accept=".zip,application/zip"
        multiple
        onChange={(e) => onFilesPicked(e.target.files)}
        aria-label={m.restore_zip_pickFile()}
      />

      {files.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#555' }}>
          {files.map((f) => <li key={f.name}>{f.name} · {Math.round(f.size / 1024)} kB</li>)}
        </ul>
      )}

      <button onClick={onRestore} disabled={busy || files.length === 0} style={primaryBtnStyle}>
        {busy ? m.restore_zip_inProgress() : m.restore_zip_button()}
      </button>

      {success && (
        <p role="status" style={{ color: '#34c759', fontSize: 13 }}>
          {m.restore_zip_success({ applied: success.applied, monthKey: success.monthKey })}
        </p>
      )}
      {error && <p role="alert" style={{ color: '#ff3b30', fontSize: 13 }}>{error}</p>}
    </section>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'grid', gap: 16, padding: 16, maxWidth: 480, margin: '0 auto',
};
const primaryBtnStyle: React.CSSProperties = {
  padding: '12px 16px', borderRadius: 10, border: 'none',
  background: '#007aff', color: '#fff', cursor: 'pointer', fontSize: 15,
};
const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 8, cursor: 'pointer', fontSize: 18,
};
