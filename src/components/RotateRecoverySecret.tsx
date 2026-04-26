import React, { useCallback, useState } from 'react';
import { useStore } from '@nanostores/react';
import {
  generateRecoverySecret,
  type RecoverySecretResult,
} from '../auth/recovery';
import { Step3DownloadQr } from './welcome/Step3DownloadQr';
import { Step3VerifyInput } from './welcome/Step3VerifyInput';
import { Step3QrDecoder } from './welcome/Step3QrDecoder';
import { localeStore, m } from '../i18n';
import type { WrappedKeyData } from '../db/keystore';

type Substep = 'qr' | 'verify' | 'success';

export type CommitRotatedRs = (newRs: Uint8Array) => Promise<WrappedKeyData>;

export interface RotateRecoverySecretProps {
  onCommit: CommitRotatedRs;
  onClose: () => void;
}

/**
 * In-app Recovery Secret rotation surface. Reuses the welcome-wizard's
 * Step 3 substeps so the user sees the same generate → display →
 * checksum-confirm gate they did at vault creation. Commit happens ONLY
 * after the verify substep succeeds; cancellation at any point keeps the
 * old wrap on disk untouched.
 */
export function RotateRecoverySecret({
  onCommit,
  onClose,
}: RotateRecoverySecretProps): JSX.Element {
  useStore(localeStore);
  const [rs] = useState<RecoverySecretResult>(() => generateRecoverySecret());
  const [substep, setSubstep] = useState<Substep>('qr');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const advanceFromQr = useCallback(() => setSubstep('verify'), []);

  const tryCommit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await onCommit(rs.raw);
      setSubstep('success');
    } catch (err) {
      console.error('[RotateRecoverySecret] commit failed', err);
      setError((err as Error).message ?? 'commit failed');
    } finally {
      setBusy(false);
    }
  }, [rs, onCommit]);

  const onScannedDecoded = useCallback(
    (decoded: RecoverySecretResult) => {
      // Match the freshly-generated RS by raw bytes.
      if (bytesEqual(decoded.raw, rs.raw)) {
        void tryCommit();
        return { ok: true as const, rs: decoded };
      }
      return { ok: false as const, reason: 'wrong-key' as const };
    },
    [rs, tryCommit],
  );

  if (substep === 'success') {
    return (
      <div
        className="welcome-stage"
        data-testid="rotate-rs-success"
        style={{ padding: 24 }}
      >
        <header className="welcome-brand">
          <p className="success-note" style={{ textAlign: 'center', margin: '0 0 18px', fontFamily: "'Fraunces', serif" }}>
            {m.rotateRs_successTitle()}
          </p>
        </header>
        <Step3DownloadQr rs={rs} onContinue={onClose} />
      </div>
    );
  }

  return (
    <div className="welcome-stage" style={{ padding: 24 }} data-testid="rotate-rs">
      <header className="welcome-brand">
        <div className="welcome-brand-wordmark">
          <span className="welcome-brand-name">{m.rotateRs_heading()}</span>
        </div>
        <p className="welcome-subtitle">{m.rotateRs_blurb()}</p>
      </header>
      {substep === 'qr' && (
        <Step3DownloadQr rs={rs} onContinue={advanceFromQr} />
      )}
      {substep === 'verify' && (
        <div>
          <p className="qr-warning" style={{ marginBottom: 12 }}>
            {m.rotateRs_warningOldStops()}
          </p>
          <Step3QrDecoder
            onDecoded={onScannedDecoded}
            labels={{
              cameraTitle: m.wizard_step3_new_verify_camera_title(),
              cameraSub: m.wizard_step3_new_verify_camera_sub(),
              galleryTitle: m.wizard_step3_new_verify_gallery_title(),
              gallerySub: m.wizard_step3_new_verify_gallery_sub(),
            }}
          />
          <div className="divider" aria-hidden="true">
            {m.wizard_step3_new_verify_or()}
          </div>
          <Step3VerifyInput
            expectedEncodedRs={rs.encoded}
            onConfirmed={() => void tryCommit()}
          />
          {busy && (
            <p className="success-note" style={{ marginTop: 12 }} role="status">
              {m.rotateRs_committing()}
            </p>
          )}
          {error && (
            <p className="input-error" role="alert" style={{ marginTop: 12 }}>
              {error}
            </p>
          )}
        </div>
      )}
      <button
        type="button"
        className="btn btn--ghost btn--block"
        onClick={onClose}
        style={{ marginTop: 12 }}
        data-testid="rotate-rs-cancel"
      >
        {m.rotateRs_cancel()}
      </button>
    </div>
  );
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
