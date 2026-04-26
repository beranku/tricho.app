import React, { useCallback, useState } from 'react';
import { fromQrPayload } from '../../auth/recovery';
import type { RecoverySecretResult } from '../../auth/recovery';
import { CameraIcon, GalleryIcon } from './icons';
import { m } from '../../i18n';

type DecodeResult =
  | { ok: true; rs: RecoverySecretResult }
  | { ok: false; reason: 'no-qr' | 'wrong-key' | 'invalid' };

interface Step3QrDecoderProps {
  /** Called with the decoded RS bytes. The caller decides whether the
   *  bytes match a generated RS (new flow) or whether they unwrap a
   *  server-side `vault-state.wrappedDekRs` (existing flow). */
  onDecoded: (rs: RecoverySecretResult) => Promise<DecodeResult> | DecodeResult;
  /** Optional copy override for the action labels (existing vs new flow). */
  labels?: {
    cameraTitle?: string;
    cameraSub?: string;
    galleryTitle?: string;
    gallerySub?: string;
  };
}

/**
 * Camera + gallery QR decoder. `jsQR` is dynamic-imported on first use
 * so the wizard's Step 1 / Step 2 bundle stays small.
 */
export function Step3QrDecoder({
  onDecoded,
  labels = {},
}: Step3QrDecoderProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const payload = await decodeQrFromFile(file);
        if (!payload) {
          setError(m.wizard_step3_existing_qr_decodeFailed());
          return;
        }
        const decoded = fromQrPayload(payload);
        if (!decoded.ok) {
          setError(m.wizard_step3_existing_qr_invalidFormat());
          return;
        }
        const callerResult = await onDecoded(decoded.rs);
        if (!callerResult.ok) {
          setError(
            callerResult.reason === 'wrong-key'
              ? m.wizard_step3_existing_qr_unwrapFailed()
              : callerResult.reason === 'no-qr'
                ? m.wizard_step3_existing_qr_decodeFailed()
                : m.wizard_step3_existing_qr_invalidFormat(),
          );
        }
      } catch (err) {
        console.error('[Step3QrDecoder] decode failed', err);
        setError(m.wizard_step3_existing_qr_decodeFailed());
      } finally {
        setBusy(false);
      }
    },
    [onDecoded],
  );

  const onCameraInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };
  const onGalleryInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="qr-decoder" aria-busy={busy || undefined}>
      <label
        className="action-row action-row--primary"
        htmlFor="wizard-qr-camera"
        data-testid="wizard-qr-camera-row"
      >
        <span className="action-row__icon">
          <CameraIcon />
        </span>
        <span className="action-row__text">
          <span className="action-row__title">
            {labels.cameraTitle ?? m.wizard_step3_existing_qr_camera_title()}
          </span>
          <span className="action-row__sub">
            {labels.cameraSub ?? m.wizard_step3_existing_qr_camera_sub()}
          </span>
        </span>
        <input
          id="wizard-qr-camera"
          type="file"
          accept="image/*"
          capture="environment"
          className="action-row__file-input"
          onChange={onCameraInput}
          disabled={busy}
        />
      </label>
      <label
        className="action-row"
        htmlFor="wizard-qr-gallery"
        style={{ marginTop: 10 }}
        data-testid="wizard-qr-gallery-row"
      >
        <span className="action-row__icon">
          <GalleryIcon />
        </span>
        <span className="action-row__text">
          <span className="action-row__title">
            {labels.galleryTitle ?? m.wizard_step3_existing_qr_gallery_title()}
          </span>
          <span className="action-row__sub">
            {labels.gallerySub ?? m.wizard_step3_existing_qr_gallery_sub()}
          </span>
        </span>
        <input
          id="wizard-qr-gallery"
          type="file"
          accept="image/*"
          className="action-row__file-input"
          onChange={onGalleryInput}
          disabled={busy}
        />
      </label>
      {error && (
        <p className="input-error" role="alert" data-testid="wizard-qr-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Decode a QR from a File via `jsQR`. Returns the QR payload string or
 * null if no QR was found. Throws only on truly unrecoverable errors.
 */
async function decodeQrFromFile(file: File): Promise<string | null> {
  const { default: jsQR } = await import('jsqr');
  const bitmap = await loadImageBitmap(file);
  const canvas = document.createElement('canvas');
  // Cap size — full-resolution camera images can be huge and `jsQR` runs
  // in a single pass over the pixel buffer.
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(imageData.data, imageData.width, imageData.height);
  return result?.data ?? null;
}

async function loadImageBitmap(file: File): Promise<HTMLImageElement | ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  // Older Safari fallback.
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}
