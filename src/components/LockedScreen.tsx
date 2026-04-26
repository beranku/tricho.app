import React, { useCallback, useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import {
  decodeRsFromInput,
  isValidRsFormat,
  parseRsInput,
} from '../auth/recovery';
import { localeStore, m } from '../i18n';
import { isWebAuthnAvailable } from '../auth/webauthn';
import { isPinValid, PIN_MIN_LENGTH, PIN_MAX_LENGTH } from '../auth/local-pin';

type Path = 'passkey' | 'pin' | 'rs';

const LOCKOUT_KEY = 'tricho-lock-pin-attempts';
const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 60_000;
const LOCKOUT_DURATION_MS = 30_000;

interface LockoutState {
  attempts: number[]; // timestamps in ms
  lockedUntil: number | null;
}

function readLockout(): LockoutState {
  try {
    const raw = sessionStorage.getItem(LOCKOUT_KEY);
    if (!raw) return { attempts: [], lockedUntil: null };
    const parsed = JSON.parse(raw) as LockoutState;
    if (!parsed || !Array.isArray(parsed.attempts)) return { attempts: [], lockedUntil: null };
    return parsed;
  } catch {
    return { attempts: [], lockedUntil: null };
  }
}

function writeLockout(state: LockoutState): void {
  try {
    sessionStorage.setItem(LOCKOUT_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage disabled — proceed without persistence
  }
}

function recordPinFailure(): LockoutState {
  const now = Date.now();
  const prior = readLockout();
  const recent = prior.attempts.filter((t) => now - t < LOCKOUT_WINDOW_MS);
  recent.push(now);
  const next: LockoutState = {
    attempts: recent,
    lockedUntil:
      recent.length >= LOCKOUT_MAX_ATTEMPTS ? now + LOCKOUT_DURATION_MS : prior.lockedUntil,
  };
  writeLockout(next);
  return next;
}

function clearLockout(): void {
  writeLockout({ attempts: [], lockedUntil: null });
}

function lockoutRemainingMs(state: LockoutState): number {
  if (state.lockedUntil == null) return 0;
  return Math.max(0, state.lockedUntil - Date.now());
}

export interface LockedScreenProps {
  hasPasskey: boolean;
  hasPin: boolean;
  onUnlockWithPasskey: () => Promise<void>;
  onUnlockWithPin: (pin: string) => Promise<void>;
  onUnlockWithRs: (rs: Uint8Array) => Promise<void>;
  onUnlocked: () => void;
}

/**
 * Daily-unlock surface for returning users. Mounted by AppShell when a
 * vault exists locally but the in-memory DEK is null. Carries the brand
 * wordmark so the user perceives continuity, not a reset.
 */
export function LockedScreen({
  hasPasskey,
  hasPin,
  onUnlockWithPasskey,
  onUnlockWithPin,
  onUnlockWithRs,
  onUnlocked,
}: LockedScreenProps): JSX.Element {
  useStore(localeStore);
  const passkeyAvailable = hasPasskey && isWebAuthnAvailable();

  // Pick the primary path. Priority: passkey > pin > rs.
  const initialPath: Path = passkeyAvailable ? 'passkey' : hasPin ? 'pin' : 'rs';
  const [path, setPath] = useState<Path>(initialPath);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState('');
  const [rsInput, setRsInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockoutMs, setLockoutMs] = useState<number>(() => lockoutRemainingMs(readLockout()));

  // Lockout countdown — re-evaluate every second so the label updates.
  useEffect(() => {
    if (lockoutMs <= 0) return;
    const id = window.setInterval(() => {
      const remaining = lockoutRemainingMs(readLockout());
      setLockoutMs(remaining);
      if (remaining <= 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [lockoutMs]);

  const onPasskey = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await onUnlockWithPasskey();
      onUnlocked();
    } catch (err) {
      console.error('[LockedScreen] passkey unlock failed', err);
      setError(m.lock_error_wrongCredential());
    } finally {
      setBusy(false);
    }
  }, [onUnlockWithPasskey, onUnlocked]);

  const onPinSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (lockoutMs > 0) return;
      if (!isPinValid(pin)) {
        setError(m.lock_error_wrongPin());
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await onUnlockWithPin(pin);
        clearLockout();
        onUnlocked();
      } catch (err) {
        console.error('[LockedScreen] pin unlock failed', err);
        const next = recordPinFailure();
        setLockoutMs(lockoutRemainingMs(next));
        setError(m.lock_error_wrongPin());
      } finally {
        setBusy(false);
      }
    },
    [pin, onUnlockWithPin, onUnlocked, lockoutMs],
  );

  const onRsSubmit = useCallback(async () => {
    const normalized = parseRsInput(rsInput);
    if (!isValidRsFormat(normalized)) {
      setError(m.lock_error_wrongRs());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const raw = decodeRsFromInput(rsInput);
      await onUnlockWithRs(raw);
      onUnlocked();
    } catch (err) {
      console.error('[LockedScreen] RS unlock failed', err);
      setError(m.lock_error_wrongRs());
    } finally {
      setBusy(false);
    }
  }, [rsInput, onUnlockWithRs, onUnlocked]);

  const switchTo = (next: Path) => {
    setPath(next);
    setError(null);
  };

  const lockoutSeconds = Math.ceil(lockoutMs / 1000);

  return (
    <div className="welcome-stage" data-testid="locked-screen">
      <header className="welcome-brand">
        <div className="welcome-brand-wordmark">
          <span className="welcome-brand-name">{m.wizard_brandName()}</span>
          <span className="welcome-brand-suffix">{m.wizard_brandSuffix()}</span>
        </div>
        <p className="welcome-subtitle">{m.lock_subtitle()}</p>
      </header>
      <section
        className="welcome-final"
        style={{ marginTop: 24, padding: '24px 20px', textAlign: 'left' }}
      >
        <p
          className="success-note"
          style={{ textAlign: 'center', margin: '0 0 18px', fontFamily: "'Fraunces', serif" }}
          data-testid="locked-greeting"
        >
          {m.lock_greeting()}
        </p>

        {path === 'passkey' && (
          <>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={onPasskey}
              disabled={busy}
              data-testid="locked-passkey-cta"
            >
              {busy ? m.lock_busy() : m.lock_primaryCta_passkey()}
            </button>
            {hasPin && (
              <button
                type="button"
                className="btn btn--ghost btn--block"
                style={{ marginTop: 12 }}
                onClick={() => switchTo('pin')}
                data-testid="locked-show-pin"
              >
                {m.lock_pinFallback()}
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--block"
              style={{ marginTop: hasPin ? 4 : 12 }}
              onClick={() => switchTo('rs')}
              data-testid="locked-show-rs"
            >
              {m.lock_recoveryFallback()}
            </button>
          </>
        )}

        {path === 'pin' && (
          <form onSubmit={onPinSubmit} style={{ display: 'grid', gap: 12 }}>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError(null);
              }}
              placeholder={m.lock_pinPlaceholder()}
              minLength={PIN_MIN_LENGTH}
              maxLength={PIN_MAX_LENGTH}
              disabled={busy || lockoutMs > 0}
              autoComplete="off"
              data-testid="locked-pin-input"
              className="manual-rs-input"
              style={{ textAlign: 'center', letterSpacing: 4, fontSize: 18 }}
            />
            <button
              type="submit"
              className="btn btn--primary btn--block"
              disabled={busy || lockoutMs > 0 || !pin.trim()}
              data-testid="locked-pin-submit"
            >
              {busy ? m.lock_busy() : m.lock_primaryCta_pin()}
            </button>
            {lockoutMs > 0 && (
              <p
                className="input-error"
                role="status"
                data-testid="locked-pin-lockout"
                style={{ marginTop: 4 }}
              >
                {m.lock_lockoutCountdown({ seconds: lockoutSeconds })}
              </p>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--block"
              style={{ marginTop: 4 }}
              onClick={() => switchTo('rs')}
              data-testid="locked-show-rs-from-pin"
            >
              {m.lock_recoveryFallback()}
            </button>
            {passkeyAvailable && (
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => switchTo('passkey')}
                data-testid="locked-back-passkey"
              >
                {m.lock_passkeyFallback()}
              </button>
            )}
          </form>
        )}

        {path === 'rs' && (
          <>
            <textarea
              className="manual-rs-input"
              value={rsInput}
              onChange={(e) => {
                setRsInput(e.target.value);
                setError(null);
              }}
              placeholder={m.lock_rsPlaceholder()}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="characters"
              data-testid="locked-rs-input"
              disabled={busy}
            />
            <button
              type="button"
              className="btn btn--primary btn--block"
              style={{ marginTop: 12 }}
              onClick={onRsSubmit}
              disabled={busy || !rsInput.trim()}
              data-testid="locked-rs-submit"
            >
              {busy ? m.lock_busy() : m.lock_rsSubmit()}
            </button>
            {hasPin && (
              <button
                type="button"
                className="btn btn--ghost btn--block"
                style={{ marginTop: 12 }}
                onClick={() => switchTo('pin')}
                data-testid="locked-back-pin"
              >
                {m.lock_pinFallback()}
              </button>
            )}
            {passkeyAvailable && (
              <button
                type="button"
                className="btn btn--ghost btn--block"
                style={{ marginTop: hasPin ? 4 : 12 }}
                onClick={() => switchTo('passkey')}
                data-testid="locked-back-passkey-from-rs"
              >
                {m.lock_passkeyFallback()}
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
