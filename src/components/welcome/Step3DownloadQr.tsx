import React, { useEffect, useRef, useState } from 'react';
import { toQrPayload, type RecoverySecretResult } from '../../auth/recovery';
import { detectBrowser } from '../../lib/launch-mode';
import { DownloadIcon } from './icons';
import { m } from '../../i18n';

interface Step3DownloadQrProps {
  rs: RecoverySecretResult;
  onContinue: () => void;
}

const QR_FILENAME = 'tricho-recovery-key.png';

/**
 * Renders the generated RS as a QR canvas, fingerprint, and download CTA.
 * Uses the existing `qrcode` dep already in `package.json`. iOS Safari's
 * `download` attribute is unreliable, so we surface a long-press hint
 * there and open the PNG in a new tab.
 */
export function Step3DownloadQr({ rs, onContinue }: Step3DownloadQrProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [downloadHint, setDownloadHint] = useState(false);
  const isIos = detectBrowser() === 'ios';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    void (async () => {
      const QR = await import('qrcode');
      if (cancelled) return;
      try {
        await QR.toCanvas(canvas, toQrPayload(rs), {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 152,
          color: {
            // Pure white background for scanner contrast — intentional
            // non-token (see ui-design-system spec). QR codes need
            // maximum contrast regardless of theme.
            light: '#FFFFFF',
            dark: '#1C1917',
          },
        });
      } catch (err) {
        console.error('[Step3DownloadQr] render failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rs]);

  const onDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      if (isIos) {
        // iOS Safari ignores `download`; open in new tab and surface a
        // long-press hint.
        window.open(url, '_blank');
        setDownloadHint(true);
        // Don't revokeObjectURL — the new tab still needs the blob.
        return;
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = QR_FILENAME;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const fingerprint = rs.encoded;
  // Format: first 12 chars in ink-3, last 4 in copper-mid bold.
  // We render three groups of 4 + a bold last 4 to match copy.md.
  const head = fingerprint.slice(0, 12);
  const last4 = fingerprint.slice(-4);
  const groups = [head.slice(0, 4), head.slice(4, 8), head.slice(8, 12)];

  return (
    <div className="qr-card">
      <p className="qr-warning" data-testid="wizard-qr-caveat">
        {m.wizard_step3_new_qr_warning()}
      </p>
      <canvas
        ref={canvasRef}
        className="qr-canvas"
        width={152}
        height={152}
        aria-label="Recovery key QR code"
        data-testid="wizard-qr-canvas"
      />
      <p className="qr-fingerprint" data-testid="wizard-qr-fingerprint">
        <span className="qr-fingerprint__label">{m.wizard_step3_new_qr_fingerprint_label()}</span>
        {groups.map((g, i) => (
          <React.Fragment key={i}>
            <span>{g}</span>
            <span> · </span>
          </React.Fragment>
        ))}
        <span className="qr-fingerprint__last4">{last4}</span>
      </p>
      <div className="qr-actions">
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={onDownload}
          data-testid="wizard-qr-download"
        >
          <DownloadIcon />
          <span>{m.wizard_step3_new_qr_download()}</span>
        </button>
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={onContinue}
          data-testid="wizard-qr-continue"
        >
          {m.wizard_step3_new_qr_continue()}
        </button>
      </div>
      {downloadHint && (
        <p className="qr-ios-hint" data-testid="wizard-qr-ios-hint">
          {m.wizard_step3_new_qr_iosLongPressHint()}
        </p>
      )}
    </div>
  );
}
