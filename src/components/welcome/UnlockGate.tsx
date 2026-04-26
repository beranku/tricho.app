import React, { useCallback, useState } from 'react';
import { useStore } from '@nanostores/react';
import {
  decodeRsFromInput,
  isValidRsFormat,
  parseRsInput,
} from '../../auth/recovery';
import { localeStore, m } from '../../i18n';
import { isWebAuthnAvailable } from '../../auth/webauthn';

interface UnlockGateProps {
  /** Whether the local vault has a registered passkey. When false, only
   *  the RS-recovery path is available. */
  hasPasskey: boolean;
  onUnlockWithPasskey: () => Promise<void>;
  onUnlockWithRs: (rs: Uint8Array) => Promise<void>;
  onUnlocked: () => void;
}

/**
 * Daily-unlock UI for users who already have a vault on this device. Not
 * part of the onboarding wizard (`WelcomeScreen`) — that surface is for
 * brand-new devices. Same brand wordmark and CSS tokens, much smaller
 * surface area.
 */
export function UnlockGate({
  hasPasskey,
  onUnlockWithPasskey,
  onUnlockWithRs,
  onUnlocked,
}: UnlockGateProps): JSX.Element {
  useStore(localeStore);
  const webAuthnReady = hasPasskey && isWebAuthnAvailable();
  const [busy, setBusy] = useState(false);
  const [showRecovery, setShowRecovery] = useState(!webAuthnReady);
  const [rsInput, setRsInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onPasskey = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await onUnlockWithPasskey();
      onUnlocked();
    } catch (err) {
      console.error('[UnlockGate] passkey unlock failed', err);
      setError(err instanceof Error ? err.message : 'Unlock failed');
    } finally {
      setBusy(false);
    }
  }, [onUnlockWithPasskey, onUnlocked]);

  const onRsSubmit = useCallback(async () => {
    const normalized = parseRsInput(rsInput);
    if (!isValidRsFormat(normalized)) {
      setError(m.wizard_step3_existing_qr_invalidFormat());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const raw = decodeRsFromInput(rsInput);
      await onUnlockWithRs(raw);
      onUnlocked();
    } catch (err) {
      console.error('[UnlockGate] RS unlock failed', err);
      setError(m.wizard_step3_existing_qr_unwrapFailed());
    } finally {
      setBusy(false);
    }
  }, [rsInput, onUnlockWithRs, onUnlocked]);

  return (
    <div className="welcome-stage" data-testid="unlock-gate">
      <header className="welcome-brand">
        <div className="welcome-brand-wordmark">
          <span className="welcome-brand-name">{m.wizard_brandName()}</span>
          <span className="welcome-brand-suffix">{m.wizard_brandSuffix()}</span>
        </div>
        <p className="welcome-subtitle">{m.wizard_subtitle()}</p>
      </header>
      <section
        className="welcome-final"
        style={{ marginTop: 24, padding: '24px 20px', textAlign: 'left' }}
      >
        {!showRecovery && webAuthnReady && (
          <>
            <p className="success-note" style={{ textAlign: 'center', margin: '0 0 18px' }}>
              {m.wizard_step3_new_webauthn_success()}
            </p>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={onPasskey}
              disabled={busy}
              data-testid="unlock-gate-passkey"
            >
              {busy
                ? m.wizard_step3_new_webauthn_busy()
                : m.wizard_step3_new_webauthn_cta()}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--block"
              style={{ marginTop: 12 }}
              onClick={() => setShowRecovery(true)}
              data-testid="unlock-gate-show-rs"
            >
              {m.wizard_step3_existing_qr_manual_title()}
            </button>
          </>
        )}
        {showRecovery && (
          <>
            <p className="section-label">
              {m.wizard_step3_existing_qr_manual_title()}
            </p>
            <textarea
              className="manual-rs-input"
              value={rsInput}
              onChange={(e) => {
                setRsInput(e.target.value);
                setError(null);
              }}
              placeholder={m.wizard_step3_existing_qr_manual_placeholder()}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="characters"
              data-testid="unlock-gate-rs-input"
              disabled={busy}
            />
            <button
              type="button"
              className="btn btn--primary btn--block"
              style={{ marginTop: 12 }}
              onClick={onRsSubmit}
              disabled={busy || !rsInput.trim()}
              data-testid="unlock-gate-rs-submit"
            >
              {m.wizard_step3_existing_qr_submit()}
            </button>
            {webAuthnReady && (
              <button
                type="button"
                className="btn btn--ghost btn--block"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setShowRecovery(false);
                  setError(null);
                }}
                data-testid="unlock-gate-back-passkey"
              >
                {m.wizard_step3_new_webauthn_cta()}
              </button>
            )}
          </>
        )}
        {error && (
          <p className="input-error" role="alert" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
