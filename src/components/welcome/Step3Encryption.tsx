import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  decodeRsFromInput,
  generateRecoverySecret,
  isValidRsFormat,
  parseRsInput,
  type RecoverySecretResult,
} from '../../auth/recovery';
import { Step3DownloadQr } from './Step3DownloadQr';
import { Step3VerifyInput } from './Step3VerifyInput';
import { Step3QrDecoder } from './Step3QrDecoder';
import type { Flow, Substep } from './wizard-state';
import { m } from '../../i18n';

interface Step3EncryptionProps {
  flow: Flow;
  substep: Substep;
  /** Generated RS for the new flow. The wizard caches it across substep
   *  changes so the user can navigate back to qr without regenerating. */
  generatedRs: RecoverySecretResult | null;
  setGeneratedRs: (rs: RecoverySecretResult) => void;

  onAdvanceSubstep: (substep: Substep) => void;

  /** Existing-flow only. Decodes the RS, derives the KEK, and unwraps
   *  the server-side wrappedDekRs. Returns the shared vaultId on success. */
  onJoinWithRs: (rs: RecoverySecretResult) => Promise<{ ok: true; vaultId: string } | { ok: false; reason: 'wrong-key' | 'invalid' }>;

  /** New-flow webauthn step: create the local vault from RS, return vaultId. */
  onCreateVault: (rs: Uint8Array) => Promise<{ vaultId: string }>;

  /** Both flows: register the passkey on the vault. */
  onRegisterPasskey: (vaultId: string) => Promise<void>;

  /** Called once everything is wired and the wizard should advance to final. */
  onCompleted: () => void;
}

export function Step3Encryption({
  flow,
  substep,
  generatedRs,
  setGeneratedRs,
  onAdvanceSubstep,
  onJoinWithRs,
  onCreateVault,
  onRegisterPasskey,
  onCompleted,
}: Step3EncryptionProps): JSX.Element {
  // For the new flow we generate the RS exactly once when the substep
  // first becomes `qr`. Caching prevents regeneration on remount.
  useEffect(() => {
    if (flow === 'new' && substep === 'qr' && !generatedRs) {
      setGeneratedRs(generateRecoverySecret());
    }
  }, [flow, substep, generatedRs, setGeneratedRs]);

  // For the existing flow we keep the joined vaultId in local state so
  // the webauthn substep can register a passkey on it.
  const [joinedVaultId, setJoinedVaultId] = useState<string | null>(null);

  if (flow === 'new') {
    return (
      <NewFlow
        substep={substep}
        generatedRs={generatedRs}
        onAdvanceSubstep={onAdvanceSubstep}
        onCreateVault={onCreateVault}
        onRegisterPasskey={onRegisterPasskey}
        onCompleted={onCompleted}
      />
    );
  }
  return (
    <ExistingFlow
      substep={substep}
      onAdvanceSubstep={onAdvanceSubstep}
      onJoinWithRs={onJoinWithRs}
      onRegisterPasskey={onRegisterPasskey}
      onCompleted={onCompleted}
      joinedVaultId={joinedVaultId}
      setJoinedVaultId={setJoinedVaultId}
    />
  );
}

/* ── New flow ─────────────────────────────────────────────────────── */

interface NewFlowProps {
  substep: Substep;
  generatedRs: RecoverySecretResult | null;
  onAdvanceSubstep: (substep: Substep) => void;
  onCreateVault: (rs: Uint8Array) => Promise<{ vaultId: string }>;
  onRegisterPasskey: (vaultId: string) => Promise<void>;
  onCompleted: () => void;
}

function NewFlow({
  substep,
  generatedRs,
  onAdvanceSubstep,
  onCreateVault,
  onRegisterPasskey,
  onCompleted,
}: NewFlowProps): JSX.Element {
  if (!generatedRs) {
    // Brief flash before the useEffect generates the RS — render nothing
    // rather than a placeholder.
    return <></>;
  }

  if (substep === 'qr') {
    return (
      <Step3DownloadQr rs={generatedRs} onContinue={() => onAdvanceSubstep('verify')} />
    );
  }

  if (substep === 'verify') {
    return <NewFlowVerify rs={generatedRs} onAdvanceSubstep={onAdvanceSubstep} />;
  }

  return (
    <NewFlowWebAuthn
      rs={generatedRs}
      onCreateVault={onCreateVault}
      onRegisterPasskey={onRegisterPasskey}
      onCompleted={onCompleted}
    />
  );
}

interface NewFlowVerifyProps {
  rs: RecoverySecretResult;
  onAdvanceSubstep: (substep: Substep) => void;
}

function NewFlowVerify({ rs, onAdvanceSubstep }: NewFlowVerifyProps): JSX.Element {
  const onDecoded = useCallback(
    (decoded: RecoverySecretResult) => {
      // Match by raw bytes: equal RS ⇒ confirm.
      if (bytesEqual(decoded.raw, rs.raw)) {
        onAdvanceSubstep('webauthn');
        return { ok: true as const, rs: decoded };
      }
      return { ok: false as const, reason: 'wrong-key' as const };
    },
    [rs, onAdvanceSubstep],
  );

  return (
    <div>
      <p className="section-label">{m.wizard_step3_new_verify_title()}</p>
      <Step3QrDecoder
        onDecoded={onDecoded}
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
        onConfirmed={() => onAdvanceSubstep('webauthn')}
      />
    </div>
  );
}

interface NewFlowWebAuthnProps {
  rs: RecoverySecretResult;
  onCreateVault: (rs: Uint8Array) => Promise<{ vaultId: string }>;
  onRegisterPasskey: (vaultId: string) => Promise<void>;
  onCompleted: () => void;
}

function NewFlowWebAuthn({
  rs,
  onCreateVault,
  onRegisterPasskey,
  onCompleted,
}: NewFlowWebAuthnProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onActivate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { vaultId } = await onCreateVault(rs.raw);
      await onRegisterPasskey(vaultId);
      onCompleted();
    } catch (err) {
      console.error('[Step3 new webauthn] failed', err);
      setError(m.wizard_step3_new_webauthn_failed());
    } finally {
      setBusy(false);
    }
  }, [rs, onCreateVault, onRegisterPasskey, onCompleted]);

  return (
    <div>
      <p className="success-note">{m.wizard_step3_new_webauthn_success()}</p>
      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={onActivate}
        disabled={busy}
        data-testid="wizard-webauthn-activate"
      >
        {busy ? m.wizard_step3_new_webauthn_busy() : m.wizard_step3_new_webauthn_cta()}
      </button>
      {error && (
        <p className="input-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ── Existing flow ────────────────────────────────────────────────── */

interface ExistingFlowProps {
  substep: Substep;
  onAdvanceSubstep: (substep: Substep) => void;
  onJoinWithRs: (rs: RecoverySecretResult) => Promise<{ ok: true; vaultId: string } | { ok: false; reason: 'wrong-key' | 'invalid' }>;
  onRegisterPasskey: (vaultId: string) => Promise<void>;
  onCompleted: () => void;
  joinedVaultId: string | null;
  setJoinedVaultId: (id: string) => void;
}

function ExistingFlow({
  substep,
  onAdvanceSubstep,
  onJoinWithRs,
  onRegisterPasskey,
  onCompleted,
  joinedVaultId,
  setJoinedVaultId,
}: ExistingFlowProps): JSX.Element {
  if (substep === 'qr') {
    return (
      <ExistingFlowQr
        onAdvanceSubstep={onAdvanceSubstep}
        onJoinWithRs={onJoinWithRs}
        setJoinedVaultId={setJoinedVaultId}
      />
    );
  }

  return (
    <ExistingFlowWebAuthn
      vaultId={joinedVaultId}
      onRegisterPasskey={onRegisterPasskey}
      onCompleted={onCompleted}
    />
  );
}

interface ExistingFlowQrProps {
  onAdvanceSubstep: (substep: Substep) => void;
  onJoinWithRs: ExistingFlowProps['onJoinWithRs'];
  setJoinedVaultId: (id: string) => void;
}

function ExistingFlowQr({
  onAdvanceSubstep,
  onJoinWithRs,
  setJoinedVaultId,
}: ExistingFlowQrProps): JSX.Element {
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tryJoin = useCallback(
    async (rs: RecoverySecretResult) => {
      const result = await onJoinWithRs(rs);
      if (result.ok) {
        setJoinedVaultId(result.vaultId);
        onAdvanceSubstep('webauthn');
        return { ok: true as const, rs };
      }
      return result;
    },
    [onJoinWithRs, onAdvanceSubstep, setJoinedVaultId],
  );

  const onManualSubmit = useCallback(async () => {
    const normalized = parseRsInput(manual);
    if (!isValidRsFormat(normalized)) {
      setManualError(m.wizard_step3_existing_qr_invalidFormat());
      return;
    }
    setBusy(true);
    setManualError(null);
    try {
      const raw = decodeRsFromInput(manual);
      // Build a `RecoverySecretResult` shape from the manual input.
      const encoded = normalized;
      const checksum = encoded.slice(-4);
      const result = await tryJoin({ raw, encoded, checksum });
      if (!result.ok) {
        setManualError(
          result.reason === 'wrong-key'
            ? m.wizard_step3_existing_qr_unwrapFailed()
            : m.wizard_step3_existing_qr_invalidFormat(),
        );
      }
    } catch (err) {
      console.error('[Step3 existing manual] decode failed', err);
      setManualError(m.wizard_step3_existing_qr_invalidFormat());
    } finally {
      setBusy(false);
    }
  }, [manual, tryJoin]);

  return (
    <div>
      <p className="section-label">{m.wizard_step3_existing_qr_title()}</p>
      <Step3QrDecoder onDecoded={tryJoin} />
      <div className="divider" aria-hidden="true">
        {m.wizard_step3_existing_qr_or()}
      </div>
      <p className="section-label" style={{ marginTop: 4 }}>
        {m.wizard_step3_existing_qr_manual_title()}
      </p>
      <textarea
        className="manual-rs-input"
        value={manual}
        onChange={(e) => {
          setManual(e.target.value);
          setManualError(null);
        }}
        placeholder={m.wizard_step3_existing_qr_manual_placeholder()}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="characters"
        aria-invalid={manualError !== null || undefined}
        data-testid="wizard-existing-manual-input"
        disabled={busy}
      />
      {manualError && (
        <p className="input-error" role="alert">
          {manualError}
        </p>
      )}
      <button
        type="button"
        className="btn btn--primary btn--block"
        style={{ marginTop: 12 }}
        onClick={onManualSubmit}
        disabled={busy || !manual.trim()}
        data-testid="wizard-existing-manual-submit"
      >
        {m.wizard_step3_existing_qr_submit()}
      </button>
    </div>
  );
}

interface ExistingFlowWebAuthnProps {
  vaultId: string | null;
  onRegisterPasskey: (vaultId: string) => Promise<void>;
  onCompleted: () => void;
}

function ExistingFlowWebAuthn({
  vaultId,
  onRegisterPasskey,
  onCompleted,
}: ExistingFlowWebAuthnProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onActivate = useCallback(async () => {
    if (!vaultId) {
      setError(m.wizard_step3_existing_webauthn_failed());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRegisterPasskey(vaultId);
      onCompleted();
    } catch (err) {
      console.error('[Step3 existing webauthn] failed', err);
      setError(m.wizard_step3_existing_webauthn_failed());
    } finally {
      setBusy(false);
    }
  }, [vaultId, onRegisterPasskey, onCompleted]);

  return (
    <div>
      <p className="success-note">{m.wizard_step3_existing_webauthn_success()}</p>
      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={onActivate}
        disabled={busy}
        data-testid="wizard-webauthn-activate"
      >
        {busy
          ? m.wizard_step3_existing_webauthn_busy()
          : m.wizard_step3_existing_webauthn_cta()}
      </button>
      {error && (
        <p className="input-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ── helpers ──────────────────────────────────────────────────────── */

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

// Suppress unused-variable warning in TS strict mode.
void useMemo;
