import React, { useCallback, useState } from 'react';
import {
  decodeRsFromInput,
  isValidRsFormat,
  parseRsInput,
} from '../auth/recovery';

export type JoinVaultState = 'idle' | 'unlocking' | 'error';

export interface JoinVaultScreenProps {
  /** Called with the decoded RS bytes when the user submits a syntactically-valid RS. */
  onJoinVault: (rs: Uint8Array) => Promise<void>;
  /** Called when the user wants to abandon the join flow and start over from OAuth. */
  onSignOut: () => void;
  className?: string;
}

export function JoinVaultScreen({
  onJoinVault,
  onSignOut,
  className,
}: JoinVaultScreenProps): JSX.Element {
  const [state, setState] = useState<JoinVaultState>('idle');
  const [rsInput, setRsInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setRsInput(e.target.value);
    setError(null);
  }, []);

  const onSubmit = useCallback(async () => {
    const normalized = parseRsInput(rsInput);
    if (!isValidRsFormat(normalized)) {
      setError('Invalid Recovery Secret format. Please check and try again.');
      return;
    }
    setState('unlocking');
    setError(null);
    try {
      const bytes = decodeRsFromInput(rsInput);
      await onJoinVault(bytes);
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Failed to unlock vault with that Recovery Secret.');
    }
  }, [rsInput, onJoinVault]);

  return (
    <div className={`login-screen login-screen--join ${className ?? ''}`}>
      <div className="login-screen__container">
        <div className="login-screen__header">
          <div className="login-screen__logo">🔐</div>
          <h1 className="login-screen__title">TrichoApp</h1>
          <p className="login-screen__subtitle">Restore vault on this device</p>
        </div>

        <div className="login-screen__content">
          <div className="login-screen__recovery">
            <h2>Restore Your Vault</h2>
            <p className="login-screen__description">
              We found an existing vault for this account. Enter your Recovery Secret to unlock it on this device.
            </p>

            <div className="login-screen__rs-input-container">
              <label htmlFor="join-rs-input" className="login-screen__label">
                Recovery Secret
              </label>
              <textarea
                id="join-rs-input"
                className={`login-screen__rs-input ${error ? 'login-screen__rs-input--error' : ''}`}
                value={rsInput}
                onChange={onChange}
                placeholder="Enter your Recovery Secret (e.g., ABCD-EFGH-IJKL-...)"
                rows={4}
                spellCheck={false}
                autoComplete="off"
                disabled={state === 'unlocking'}
              />
              {error && (
                <div className="login-screen__input-error" role="alert">
                  {error}
                </div>
              )}
            </div>

            <div className="login-screen__actions">
              <button
                type="button"
                className="login-screen__btn login-screen__btn--secondary"
                onClick={onSignOut}
                disabled={state === 'unlocking'}
              >
                Sign out
              </button>
              <button
                type="button"
                className="login-screen__btn login-screen__btn--primary"
                onClick={onSubmit}
                disabled={!rsInput.trim() || state === 'unlocking'}
              >
                {state === 'unlocking' ? 'Unlocking…' : 'Unlock'}
              </button>
            </div>
          </div>
        </div>

        <div className="login-screen__footer">
          <p className="login-screen__footer-text">
            Your Recovery Secret stays on this device. The server only ever sees encrypted data.
          </p>
        </div>
      </div>
    </div>
  );
}
