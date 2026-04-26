import React, { useCallback, useRef, useState } from 'react';
import { validateRSChecksum } from '../../auth/recovery';
import { m } from '../../i18n';

interface Step3VerifyInputProps {
  /** Base32-encoded RS as produced by `generateRecoverySecret().encoded`. */
  expectedEncodedRs: string;
  /** Called when the user types last-4 that matches the expected checksum. */
  onConfirmed: () => void;
}

const BASE32_ALPHABET = /[^A-Z2-7]/g;

/**
 * 4-character Base32 last-4 input. Filters live to A-Z + 2-7 (case-
 * insensitive, uppercased on input). Validates on submit; mismatch shows
 * an amber border and refocuses the input.
 */
export function Step3VerifyInput({
  expectedEncodedRs,
  onConfirmed,
}: Step3VerifyInputProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const filtered = e.target.value
      .toUpperCase()
      .replace(BASE32_ALPHABET, '')
      .slice(0, 4);
    setValue(filtered);
    setInvalid(false);
  }, []);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (value.length !== 4) {
        setInvalid(true);
        inputRef.current?.focus();
        return;
      }
      if (validateRSChecksum(expectedEncodedRs, value)) {
        onConfirmed();
        return;
      }
      setInvalid(true);
      inputRef.current?.focus();
    },
    [value, expectedEncodedRs, onConfirmed],
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      <p className="section-label">{m.wizard_step3_new_verify_last4_title()}</p>
      <label htmlFor="wizard-last4" className="aria-live-region">
        {m.wizard_step3_new_verify_last4_title()}
      </label>
      <input
        id="wizard-last4"
        ref={inputRef}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={4}
        className="last4-input"
        value={value}
        onChange={onChange}
        aria-invalid={invalid || undefined}
        placeholder={m.wizard_step3_new_verify_last4_placeholder()}
        data-testid="wizard-last4-input"
      />
      {invalid && (
        <p className="input-error" role="alert">
          {m.wizard_step3_new_verify_mismatch()}
        </p>
      )}
      <button
        type="submit"
        className="btn btn--primary btn--block"
        style={{ marginTop: 12 }}
        data-testid="wizard-last4-submit"
        disabled={value.length !== 4}
      >
        {m.wizard_step3_new_verify_submit()}
      </button>
    </form>
  );
}
