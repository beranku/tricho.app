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
import { PinSetupScreen } from '../PinSetupScreen';
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

  /** Both flows: register the passkey on the vault. Returns the registration
   *  result so the wizard can branch on PRF support. */
  onRegisterPasskey: (vaultId: string) => Promise<{ prfSupported: boolean }>;

  /** PIN-setup substep: wraps the in-memory DEK with a PBKDF2-derived KEK
   *  and persists `wrappedDekPin` + `pinSalt`. */
  onSetupPin: (vaultId: string, pin: string) => Promise<void>;

  /** Called when registration succeeded but PRF is not supported — wizard
   *  routes through the `pin-setup` substep before completing. */
  onAdvanceToPinSetup: () => void;

  /** Existing flow only: switch the user from the RS-typed branch to the
   *  ZIP-restore branch. The wizard dispatches `SET_FLOW: 'restore-zip'`. */
  onSwitchToRestoreZip?: () => void;

  /** Restore-zip flow callbacks. */
  onRestoreFromZip?: (
    files: File[],
    rs: Uint8Array,
  ) => Promise<{ ok: true; vaultId: string } | { ok: false; reason: string }>;

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
  onSetupPin,
  onAdvanceToPinSetup,
  onSwitchToRestoreZip,
  onRestoreFromZip,
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
        onSetupPin={onSetupPin}
        onAdvanceToPinSetup={onAdvanceToPinSetup}
        onCompleted={onCompleted}
      />
    );
  }
  if (flow === 'restore-zip') {
    return (
      <RestoreZipFlow
        substep={substep}
        onAdvanceSubstep={onAdvanceSubstep}
        onRestoreFromZip={onRestoreFromZip}
        onRegisterPasskey={onRegisterPasskey}
        onSetupPin={onSetupPin}
        onAdvanceToPinSetup={onAdvanceToPinSetup}
        onCompleted={onCompleted}
        joinedVaultId={joinedVaultId}
        setJoinedVaultId={setJoinedVaultId}
      />
    );
  }
  return (
    <ExistingFlow
      substep={substep}
      onAdvanceSubstep={onAdvanceSubstep}
      onJoinWithRs={onJoinWithRs}
      onRegisterPasskey={onRegisterPasskey}
      onSetupPin={onSetupPin}
      onAdvanceToPinSetup={onAdvanceToPinSetup}
      onCompleted={onCompleted}
      joinedVaultId={joinedVaultId}
      setJoinedVaultId={setJoinedVaultId}
      onSwitchToRestoreZip={onSwitchToRestoreZip}
    />
  );
}

/* ── New flow ─────────────────────────────────────────────────────── */

interface NewFlowProps {
  substep: Substep;
  generatedRs: RecoverySecretResult | null;
  onAdvanceSubstep: (substep: Substep) => void;
  onCreateVault: (rs: Uint8Array) => Promise<{ vaultId: string }>;
  onRegisterPasskey: (vaultId: string) => Promise<{ prfSupported: boolean }>;
  onSetupPin: (vaultId: string, pin: string) => Promise<void>;
  onAdvanceToPinSetup: () => void;
  onCompleted: () => void;
}

function NewFlow({
  substep,
  generatedRs,
  onAdvanceSubstep,
  onCreateVault,
  onRegisterPasskey,
  onSetupPin,
  onAdvanceToPinSetup,
  onCompleted,
}: NewFlowProps): JSX.Element {
  // The webauthn substep records the registered vaultId so the optional
  // pin-setup substep can wrap the DEK against that vault.
  const [registeredVaultId, setRegisteredVaultId] = useState<string | null>(null);

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

  if (substep === 'pin-setup') {
    return (
      <PinSetupTerminal
        vaultId={registeredVaultId}
        onSetupPin={onSetupPin}
        onCompleted={onCompleted}
      />
    );
  }

  return (
    <NewFlowWebAuthn
      rs={generatedRs}
      onCreateVault={onCreateVault}
      onRegisterPasskey={onRegisterPasskey}
      onAdvanceToPinSetup={onAdvanceToPinSetup}
      onCompleted={onCompleted}
      onRegistered={setRegisteredVaultId}
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
  onRegisterPasskey: (vaultId: string) => Promise<{ prfSupported: boolean }>;
  onAdvanceToPinSetup: () => void;
  onCompleted: () => void;
  onRegistered: (vaultId: string) => void;
}

function NewFlowWebAuthn({
  rs,
  onCreateVault,
  onRegisterPasskey,
  onAdvanceToPinSetup,
  onCompleted,
  onRegistered,
}: NewFlowWebAuthnProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onActivate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { vaultId } = await onCreateVault(rs.raw);
      const { prfSupported } = await onRegisterPasskey(vaultId);
      onRegistered(vaultId);
      if (prfSupported) {
        onCompleted();
      } else {
        onAdvanceToPinSetup();
      }
    } catch (err) {
      console.error('[Step3 new webauthn] failed', err);
      setError(m.wizard_step3_new_webauthn_failed());
    } finally {
      setBusy(false);
    }
  }, [rs, onCreateVault, onRegisterPasskey, onAdvanceToPinSetup, onCompleted, onRegistered]);

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
  onRegisterPasskey: (vaultId: string) => Promise<{ prfSupported: boolean }>;
  onSetupPin: (vaultId: string, pin: string) => Promise<void>;
  onAdvanceToPinSetup: () => void;
  onCompleted: () => void;
  joinedVaultId: string | null;
  setJoinedVaultId: (id: string) => void;
  onSwitchToRestoreZip?: () => void;
}

function ExistingFlow({
  substep,
  onAdvanceSubstep,
  onJoinWithRs,
  onRegisterPasskey,
  onSetupPin,
  onAdvanceToPinSetup,
  onCompleted,
  joinedVaultId,
  setJoinedVaultId,
  onSwitchToRestoreZip,
}: ExistingFlowProps): JSX.Element {
  if (substep === 'qr') {
    return (
      <ExistingFlowQr
        onAdvanceSubstep={onAdvanceSubstep}
        onJoinWithRs={onJoinWithRs}
        setJoinedVaultId={setJoinedVaultId}
        onSwitchToRestoreZip={onSwitchToRestoreZip}
      />
    );
  }

  if (substep === 'pin-setup') {
    return (
      <PinSetupTerminal
        vaultId={joinedVaultId}
        onSetupPin={onSetupPin}
        onCompleted={onCompleted}
      />
    );
  }

  return (
    <ExistingFlowWebAuthn
      vaultId={joinedVaultId}
      onRegisterPasskey={onRegisterPasskey}
      onAdvanceToPinSetup={onAdvanceToPinSetup}
      onCompleted={onCompleted}
    />
  );
}

interface ExistingFlowQrProps {
  onAdvanceSubstep: (substep: Substep) => void;
  onJoinWithRs: ExistingFlowProps['onJoinWithRs'];
  setJoinedVaultId: (id: string) => void;
  onSwitchToRestoreZip?: () => void;
}

function ExistingFlowQr({
  onAdvanceSubstep,
  onJoinWithRs,
  setJoinedVaultId,
  onSwitchToRestoreZip,
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
      {onSwitchToRestoreZip && !manual.trim() && (
        <button
          type="button"
          className="btn btn--ghost btn--block"
          style={{ marginTop: 8, fontSize: 13 }}
          onClick={onSwitchToRestoreZip}
          data-testid="wizard-existing-switch-to-zip"
        >
          {m.wizard_step3_existing_haveZip()}
        </button>
      )}
    </div>
  );
}

interface ExistingFlowWebAuthnProps {
  vaultId: string | null;
  onRegisterPasskey: (vaultId: string) => Promise<{ prfSupported: boolean }>;
  onAdvanceToPinSetup: () => void;
  onCompleted: () => void;
}

function ExistingFlowWebAuthn({
  vaultId,
  onRegisterPasskey,
  onAdvanceToPinSetup,
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
      const { prfSupported } = await onRegisterPasskey(vaultId);
      if (prfSupported) {
        onCompleted();
      } else {
        onAdvanceToPinSetup();
      }
    } catch (err) {
      console.error('[Step3 existing webauthn] failed', err);
      setError(m.wizard_step3_existing_webauthn_failed());
    } finally {
      setBusy(false);
    }
  }, [vaultId, onRegisterPasskey, onAdvanceToPinSetup, onCompleted]);

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

/* ── Restore-from-ZIP flow ─────────────────────────────────────────── */

interface RestoreZipFlowProps {
  substep: Substep;
  onAdvanceSubstep: (substep: Substep) => void;
  onRestoreFromZip?: (
    files: File[],
    rs: Uint8Array,
  ) => Promise<{ ok: true; vaultId: string } | { ok: false; reason: string }>;
  onRegisterPasskey: (vaultId: string) => Promise<{ prfSupported: boolean }>;
  onSetupPin: (vaultId: string, pin: string) => Promise<void>;
  onAdvanceToPinSetup: () => void;
  onCompleted: () => void;
  joinedVaultId: string | null;
  setJoinedVaultId: (id: string) => void;
}

function RestoreZipFlow({
  substep,
  onAdvanceSubstep,
  onRestoreFromZip,
  onRegisterPasskey,
  onSetupPin,
  onAdvanceToPinSetup,
  onCompleted,
  joinedVaultId,
  setJoinedVaultId,
}: RestoreZipFlowProps): JSX.Element {
  const [files, setFiles] = useState<File[]>([]);

  if (substep === 'pick-zip') {
    return (
      <PickZipPanel
        files={files}
        setFiles={setFiles}
        onContinue={() => onAdvanceSubstep('verify-rs')}
      />
    );
  }

  if (substep === 'verify-rs') {
    return (
      <VerifyRsForZipPanel
        files={files}
        onRestoreFromZip={onRestoreFromZip}
        onRestored={(vaultId) => {
          setJoinedVaultId(vaultId);
          onAdvanceSubstep('webauthn');
        }}
      />
    );
  }

  if (substep === 'pin-setup') {
    return (
      <PinSetupTerminal
        vaultId={joinedVaultId}
        onSetupPin={onSetupPin}
        onCompleted={onCompleted}
      />
    );
  }

  return (
    <ExistingFlowWebAuthn
      vaultId={joinedVaultId}
      onRegisterPasskey={onRegisterPasskey}
      onAdvanceToPinSetup={onAdvanceToPinSetup}
      onCompleted={onCompleted}
    />
  );
}

interface PickZipPanelProps {
  files: File[];
  setFiles: (files: File[]) => void;
  onContinue: () => void;
}

function PickZipPanel({ files, setFiles, onContinue }: PickZipPanelProps): JSX.Element {
  const onPick = useCallback(
    (chosen: FileList | null) => {
      if (!chosen) return;
      const arr = Array.from(chosen).filter(
        (f) => f.name.endsWith('.zip') || f.name.endsWith('.tricho-backup.zip'),
      );
      // Sort by filename — typically YYYY-MM.tricho-backup.zip — for chronological order.
      arr.sort((a, b) => a.name.localeCompare(b.name));
      setFiles(arr);
    },
    [setFiles],
  );

  return (
    <div data-testid="wizard-restore-pick-zip">
      <p className="section-label">{m.wizard_step3_restoreZip_pick_title()}</p>
      <p style={{ fontSize: 13, color: 'var(--ink-2, rgb(85,85,85))', margin: '0 0 12px' }}>
        {m.wizard_step3_restoreZip_pick_blurb()}
      </p>
      <input
        type="file"
        accept=".zip,application/zip"
        multiple
        onChange={(e) => onPick(e.target.files)}
        aria-label={m.wizard_step3_restoreZip_pick_aria()}
        data-testid="wizard-restore-pick-input"
      />
      {files.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-3, rgb(136,136,136))', marginTop: 8 }} data-testid="wizard-restore-pick-hint">
          {m.wizard_step3_restoreZip_pick_hint()}
        </p>
      ) : (
        <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--ink-2, rgb(85,85,85))' }} data-testid="wizard-restore-pick-list">
          {files.map((f) => (
            <li key={f.name}>
              {f.name} · {Math.round(f.size / 1024)} kB
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="btn btn--primary btn--block"
        style={{ marginTop: 16 }}
        onClick={onContinue}
        disabled={files.length === 0}
        data-testid="wizard-restore-pick-continue"
      >
        {m.wizard_step3_restoreZip_pick_continue()}
      </button>
    </div>
  );
}

interface VerifyRsForZipPanelProps {
  files: File[];
  onRestoreFromZip?: RestoreZipFlowProps['onRestoreFromZip'];
  onRestored: (vaultId: string) => void;
}

function VerifyRsForZipPanel({
  files,
  onRestoreFromZip,
  onRestored,
}: VerifyRsForZipPanelProps): JSX.Element {
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = useCallback(async () => {
    if (!onRestoreFromZip) {
      setError(m.wizard_step3_restoreZip_verify_unavailable());
      return;
    }
    const normalized = parseRsInput(manual);
    if (!isValidRsFormat(normalized)) {
      setError(m.wizard_step3_existing_qr_invalidFormat());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const raw = decodeRsFromInput(manual);
      const result = await onRestoreFromZip(files, raw);
      if (result.ok) {
        onRestored(result.vaultId);
        return;
      }
      setError(result.reason || m.wizard_step3_existing_qr_unwrapFailed());
    } catch (err) {
      console.error('[wizard restore-zip] failed', err);
      setError(m.wizard_step3_existing_qr_invalidFormat());
    } finally {
      setBusy(false);
    }
  }, [manual, files, onRestoreFromZip, onRestored]);

  return (
    <div data-testid="wizard-restore-verify-rs">
      <p className="section-label">{m.wizard_step3_restoreZip_verify_title()}</p>
      <p style={{ fontSize: 13, color: 'var(--ink-2, rgb(85,85,85))', margin: '0 0 12px' }}>
        {m.wizard_step3_restoreZip_verify_blurb()}
      </p>
      <textarea
        className="manual-rs-input"
        value={manual}
        onChange={(e) => {
          setManual(e.target.value);
          setError(null);
        }}
        placeholder={m.wizard_step3_existing_qr_manual_placeholder()}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="characters"
        disabled={busy}
        data-testid="wizard-restore-verify-input"
      />
      {error && (
        <p className="input-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn--primary btn--block"
        style={{ marginTop: 12 }}
        onClick={onSubmit}
        disabled={busy || !manual.trim() || files.length === 0}
        data-testid="wizard-restore-verify-submit"
      >
        {busy ? m.lock_busy() : m.wizard_step3_restoreZip_verify_submit()}
      </button>
    </div>
  );
}

/* ── PIN setup terminal substep ────────────────────────────────────── */

interface PinSetupTerminalProps {
  vaultId: string | null;
  onSetupPin: (vaultId: string, pin: string) => Promise<void>;
  onCompleted: () => void;
}

function PinSetupTerminal({
  vaultId,
  onSetupPin,
  onCompleted,
}: PinSetupTerminalProps): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const onSubmit = useCallback(
    async (pin: string) => {
      if (!vaultId) {
        setError(m.wizard_step3_existing_webauthn_failed());
        return;
      }
      try {
        await onSetupPin(vaultId, pin);
        onCompleted();
      } catch (err) {
        console.error('[Step3 pin-setup] failed', err);
        setError(m.wizard_step3_existing_webauthn_failed());
      }
    },
    [vaultId, onSetupPin, onCompleted],
  );
  return (
    <PinSetupScreen mode="setup" onSubmit={onSubmit} error={error} />
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
