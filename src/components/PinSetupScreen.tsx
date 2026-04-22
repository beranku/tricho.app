import React, { useCallback, useState } from 'react';
import { isPinValid, PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../auth/local-pin';

export interface PinSetupScreenProps {
  mode: 'setup' | 'unlock';
  title?: string;
  description?: string;
  onSubmit: (pin: string) => Promise<void> | void;
  onCancel?: () => void;
  error?: string | null;
}

export function PinSetupScreen({
  mode,
  title,
  description,
  onSubmit,
  onCancel,
  error,
}: PinSetupScreenProps): JSX.Element {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLocalError(null);
      if (!isPinValid(pin)) {
        setLocalError(`PIN must be ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} characters.`);
        return;
      }
      if (mode === 'setup' && pin !== confirm) {
        setLocalError('PINs do not match.');
        return;
      }
      setBusy(true);
      try {
        await onSubmit(pin);
      } finally {
        setBusy(false);
      }
    },
    [pin, confirm, mode, onSubmit],
  );

  return (
    <div style={{ maxWidth: 420, margin: '120px auto', padding: 32, borderRadius: 20, background: 'rgba(255,255,255,0.9)', boxShadow: '0 18px 40px rgba(15,23,42,0.18)' }}>
      <h2 style={{ margin: '0 0 8px' }}>{title ?? (mode === 'setup' ? 'Set a local PIN' : 'Unlock with PIN')}</h2>
      <p style={{ margin: '0 0 16px', color: '#555', fontSize: 14 }}>
        {description ?? (mode === 'setup'
          ? 'This device does not support biometric key derivation, so we\'ll use a PIN as the daily unlock. The PIN stays on this device — the server never sees it.'
          : 'Enter your PIN to unlock the vault on this device.')}
      </p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          minLength={PIN_MIN_LENGTH}
          maxLength={PIN_MAX_LENGTH}
          style={{ padding: 12, borderRadius: 10, border: '1px solid #d1d5db', fontSize: 18, letterSpacing: 4, textAlign: 'center' }}
        />
        {mode === 'setup' && (
          <input
            type="password"
            inputMode="numeric"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm PIN"
            minLength={PIN_MIN_LENGTH}
            maxLength={PIN_MAX_LENGTH}
            style={{ padding: 12, borderRadius: 10, border: '1px solid #d1d5db', fontSize: 18, letterSpacing: 4, textAlign: 'center' }}
          />
        )}
        {(localError || error) && (
          <div role="alert" style={{ color: '#ff3b30', fontSize: 13 }}>{localError ?? error}</div>
        )}
        <button
          type="submit"
          disabled={busy}
          style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: '#007aff', color: '#fff', cursor: 'pointer', fontSize: 15, fontWeight: 500 }}
        >
          {busy ? 'Working…' : mode === 'setup' ? 'Save PIN' : 'Unlock'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{ background: 'transparent', border: 'none', color: '#007aff', cursor: 'pointer', fontSize: 13 }}
          >
            Cancel
          </button>
        )}
      </form>
    </div>
  );
}
