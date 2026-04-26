import React, { useCallback, useState } from 'react';
import { useStore } from '@nanostores/react';
import {
  decodeRsFromInput,
  encodeBase32,
  generateRSChecksum,
  isValidRsFormat,
  parseRsInput,
  type RecoverySecretResult,
} from '../auth/recovery';
import { Step3DownloadQr } from './welcome/Step3DownloadQr';
import { localeStore, m } from '../i18n';

export interface ShowRecoverySecretProps {
  /**
   * Verifier: takes raw RS bytes, returns true if they unwrap the current
   * vault's `wrappedDekRs` (i.e. they're the real RS, not a guess).
   * Implementations re-derive the KEK and attempt to unwrap; success means
   * the user has produced their actual RS.
   */
  onVerify: (rs: Uint8Array) => Promise<boolean>;
  onClose: () => void;
}

/**
 * In-app Recovery Secret viewer. The RS is never stored, so re-displaying
 * it requires the user to type it once. We verify the typed RS unwraps
 * the local `wrappedDekRs` before rendering the QR.
 */
export function ShowRecoverySecret({
  onVerify,
  onClose,
}: ShowRecoverySecretProps): JSX.Element {
  useStore(localeStore);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState<RecoverySecretResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(async () => {
    const normalized = parseRsInput(input);
    if (!isValidRsFormat(normalized)) {
      setError(m.showRs_error_invalidFormat());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const raw = decodeRsFromInput(input);
      const ok = await onVerify(raw);
      if (!ok) {
        setError(m.showRs_error_wrongKey());
        return;
      }
      const encoded = encodeBase32(raw);
      const checksum = generateRSChecksum(encoded);
      setVerified({ raw, encoded, checksum });
    } catch (err) {
      console.error('[ShowRecoverySecret] verify failed', err);
      setError(m.showRs_error_invalidFormat());
    } finally {
      setBusy(false);
    }
  }, [input, onVerify]);

  if (verified) {
    return (
      <div className="welcome-stage" style={{ padding: 24 }} data-testid="show-rs-success">
        <header className="welcome-brand">
          <p
            className="success-note"
            style={{ textAlign: 'center', margin: '0 0 18px', fontFamily: "'Fraunces', serif" }}
          >
            {m.showRs_successTitle()}
          </p>
        </header>
        <Step3DownloadQr rs={verified} onContinue={onClose} />
        <button
          type="button"
          className="btn btn--ghost btn--block"
          style={{ marginTop: 12 }}
          onClick={onClose}
          data-testid="show-rs-close"
        >
          {m.showRs_close()}
        </button>
      </div>
    );
  }

  return (
    <div className="welcome-stage" style={{ padding: 24 }} data-testid="show-rs">
      <header className="welcome-brand">
        <div className="welcome-brand-wordmark">
          <span className="welcome-brand-name">{m.showRs_heading()}</span>
        </div>
        <p className="welcome-subtitle">{m.showRs_blurb()}</p>
      </header>
      <textarea
        className="manual-rs-input"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setError(null);
        }}
        placeholder={m.lock_rsPlaceholder()}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="characters"
        disabled={busy}
        data-testid="show-rs-input"
      />
      <button
        type="button"
        className="btn btn--primary btn--block"
        style={{ marginTop: 12 }}
        onClick={onSubmit}
        disabled={busy || !input.trim()}
        data-testid="show-rs-submit"
      >
        {busy ? m.lock_busy() : m.showRs_submit()}
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--block"
        style={{ marginTop: 12 }}
        onClick={onClose}
        data-testid="show-rs-cancel"
      >
        {m.showRs_cancel()}
      </button>
      {error && (
        <p className="input-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
    </div>
  );
}
