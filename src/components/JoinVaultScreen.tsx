import React, { useCallback, useState } from 'react';
import { useStore } from '@nanostores/react';
import {
  decodeRsFromInput,
  isValidRsFormat,
  parseRsInput,
} from '../auth/recovery';
import { localeStore, m } from '../i18n';

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
  useStore(localeStore);
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
      setError(m.login_recovery_invalidFormat());
      return;
    }
    setState('unlocking');
    setError(null);
    try {
      const bytes = decodeRsFromInput(rsInput);
      await onJoinVault(bytes);
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : m.join_failed());
    }
  }, [rsInput, onJoinVault]);

  return (
    <div className={`login-screen login-screen--join ${className ?? ''}`}>
      <div className="login-screen__container">
        <div className="login-screen__header">
          <div className="login-screen__logo">🔐</div>
          <h1 className="login-screen__title">TrichoApp</h1>
          <p className="login-screen__subtitle">{m.join_screenSubtitle()}</p>
        </div>

        <div className="login-screen__content">
          <div className="login-screen__recovery">
            <h2>{m.join_restoreTitle()}</h2>
            <p className="login-screen__description">{m.join_restoreDescription()}</p>

            <div className="login-screen__rs-input-container">
              <label htmlFor="join-rs-input" className="login-screen__label">
                {m.login_recovery_label()}
              </label>
              <textarea
                id="join-rs-input"
                className={`login-screen__rs-input ${error ? 'login-screen__rs-input--error' : ''}`}
                value={rsInput}
                onChange={onChange}
                placeholder={m.login_recovery_placeholder()}
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
                {m.join_signOut()}
              </button>
              <button
                type="button"
                className="login-screen__btn login-screen__btn--primary"
                onClick={onSubmit}
                disabled={!rsInput.trim() || state === 'unlocking'}
              >
                {state === 'unlocking' ? m.join_unlocking() : m.join_unlock()}
              </button>
            </div>
          </div>
        </div>

        <div className="login-screen__footer">
          <p className="login-screen__footer-text">
            {m.join_footer()}
          </p>
        </div>
      </div>
    </div>
  );
}
