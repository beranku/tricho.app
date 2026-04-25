import React, { useCallback, useState } from 'react';
import { useStore } from '@nanostores/react';
import { isPinValid, PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../auth/local-pin';
import { localeStore, m } from '../i18n';

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
  useStore(localeStore);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLocalError(null);
      if (!isPinValid(pin)) {
        setLocalError(m.pin_invalidLength({ min: PIN_MIN_LENGTH, max: PIN_MAX_LENGTH }));
        return;
      }
      if (mode === 'setup' && pin !== confirm) {
        setLocalError(m.pin_error_mismatch());
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

  const resolvedTitle = title ?? (mode === 'setup' ? m.pin_setupTitle() : m.pin_unlockTitle());
  const resolvedDescription =
    description ?? (mode === 'setup' ? m.pin_setupDescription() : m.pin_unlockDescription());

  return (
    <div style={{ maxWidth: 420, margin: '120px auto', padding: 32, borderRadius: 20, background: 'rgba(255,255,255,0.9)', boxShadow: '0 18px 40px rgba(15,23,42,0.18)' }}>
      <h2 style={{ margin: '0 0 8px' }}>{resolvedTitle}</h2>
      <p style={{ margin: '0 0 16px', color: '#555', fontSize: 14 }}>{resolvedDescription}</p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder={m.pin_label()}
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
            placeholder={m.pin_confirm_label()}
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
          {busy ? m.pin_busy() : mode === 'setup' ? m.pin_submit() : m.pin_unlockButton()}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{ background: 'transparent', border: 'none', color: '#007aff', cursor: 'pointer', fontSize: 13 }}
          >
            {m.pin_cancel()}
          </button>
        )}
      </form>
    </div>
  );
}
