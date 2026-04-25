/**
 * Cam-card — getUserMedia → video → canvas → JPEG → encrypted attachment.
 * Same envelope-encrypt path as <PhotoCapture> so the photo-attachments spec
 * and existing storePhoto integration test still cover us.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VaultDb } from '../../db/pouch';
import { storePhoto } from '../../sync/photos';
import { envelopeEncrypt, encodeBase64url, decodeBase64url } from '../../crypto/envelope';
import type { PhotoAngle } from '../../db/types';

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

const ANGLE_LABELS: Record<PhotoAngle, string> = {
  before: 'Před',
  detail: 'Detail',
  after: 'Po',
};

export interface CameraCardProps {
  db: VaultDb;
  vaultId: string;
  customerId: string;
  appointmentId?: string;
  onCaptured?: (photoId: string) => void;
}

export function CameraCard({ db, vaultId, customerId, appointmentId, onCaptured }: CameraCardProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [angle, setAngle] = useState<PhotoAngle>('before');
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setPermissionDenied(true);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const capture = useCallback(async () => {
    if (!videoRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const video = videoRef.current;
      const scale = Math.min(1, MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas context unavailable.');
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY),
      );
      if (!blob) throw new Error('Canvas.toBlob returned null.');

      const plaintext = new Uint8Array(await blob.arrayBuffer());
      const aad = new TextEncoder().encode(vaultId);
      const { ct, iv } = await envelopeEncrypt(db.dek, plaintext, aad);
      const cipherBytes = decodeBase64url(ct);
      const cipherBlob = new Blob(
        [JSON.stringify({ iv, aad: encodeBase64url(aad) }) + '\n', cipherBytes as BlobPart],
        { type: 'application/octet-stream' },
      );

      const id = await storePhoto(db, {
        meta: {
          customerId,
          appointmentId,
          takenAt: Date.now(),
          contentType: 'image/jpeg',
          angle,
          label: ANGLE_LABELS[angle],
        },
        cipherBlob,
      });
      onCaptured?.(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, db, vaultId, customerId, appointmentId, angle, onCaptured]);

  if (permissionDenied) {
    return (
      <div className="cam-card cam-card--denied">
        <p className="cam-card-denied-text">
          Pro zachycení fotografie je potřeba povolit přístup ke kameře.
        </p>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="cam-card">
      <div className="cam-preview">
        <div className="cam-corner left" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2 L4 14 H11 L9 22 L20 8 H13 Z" />
          </svg>
        </div>
        <div className="cam-corner right" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="Geist, sans-serif" fontSize="9" fontWeight={600}>UV</text>
          </svg>
        </div>
        <video ref={videoRef} className="cam-video" playsInline muted></video>
        <div className={`cam-label-wrap ${menuOpen ? 'open' : ''}`}>
          <button
            type="button"
            className="cam-label-chip"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="cam-label-current">{ANGLE_LABELS[angle]}</span>
            <span className="cam-label-caret" aria-hidden="true">▼</span>
          </button>
          <div role="menu" className="cam-label-menu">
            {(['before', 'detail', 'after'] as const).map((a) => (
              <button
                key={a}
                type="button"
                role="menuitemradio"
                aria-checked={a === angle}
                className={`cam-label-option ${a === angle ? 'active' : ''}`}
                onClick={() => { setAngle(a); setMenuOpen(false); }}
              >
                {ANGLE_LABELS[a]}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="cam-capture"
          aria-label="Pořídit fotografii"
          onClick={capture}
          disabled={busy}
        />
      </div>
      {error && <p className="cam-error" role="alert">{error}</p>}
      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .cam-card {
    margin: 0 12px 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 24px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: var(--card-shadow);
    position: relative;
    z-index: 2;
  }
  .cam-card--denied {
    padding: 28px 22px;
    text-align: center;
  }
  .cam-card-denied-text {
    font-family: 'Patrick Hand', cursive;
    font-size: 17px;
    color: var(--ink-3);
    line-height: 1.4;
  }
  .cam-preview {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(175deg, #2B241C 0%, #1B1510 100%);
    min-height: 360px;
    position: relative;
    overflow: hidden;
  }
  .cam-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: transparent;
  }
  .cam-corner {
    position: absolute;
    top: 14px;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: rgba(20, 15, 12, 0.55);
    border: 1px solid rgba(253, 250, 243, 0.18);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(253, 250, 243, 0.92);
    z-index: 2;
  }
  .cam-corner.left { left: 14px; }
  .cam-corner.right { right: 14px; }
  .cam-capture {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    width: 62px;
    height: 62px;
    border-radius: 50%;
    background: transparent;
    border: 3px solid rgba(253, 250, 243, 0.96);
    cursor: pointer;
    padding: 0;
    z-index: 4;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2), 0 4px 14px rgba(0, 0, 0, 0.35);
  }
  .cam-capture::after {
    content: '';
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    background: rgba(253, 250, 243, 0.96);
    transition: transform 0.1s ease;
  }
  .cam-capture:active::after { transform: scale(0.88); }
  .cam-capture:disabled { opacity: 0.6; cursor: not-allowed; }
  .cam-label-wrap {
    position: absolute;
    bottom: 14px;
    left: 14px;
    z-index: 3;
  }
  .cam-label-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px 5px;
    border-radius: 6px;
    background: rgba(253, 250, 243, 0.92);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: none;
    cursor: pointer;
    line-height: 1.15;
    min-height: 30px;
  }
  .cam-label-current {
    font-family: 'Patrick Hand', cursive;
    font-size: 15px;
    color: var(--ink-espresso);
  }
  .cam-label-caret {
    color: var(--copper);
    transition: transform var(--t-base);
  }
  .cam-label-wrap.open .cam-label-caret { transform: rotate(180deg); }
  .cam-label-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    background: rgba(253, 250, 243, 0.96);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-radius: 10px;
    padding: 4px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18), 0 1px 4px rgba(0, 0, 0, 0.08);
    display: none;
    flex-direction: column;
    gap: 1px;
    min-width: 92px;
  }
  .cam-label-wrap.open .cam-label-menu { display: flex; }
  .cam-label-option {
    padding: 6px 10px;
    border-radius: 6px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    font-family: 'Patrick Hand', cursive;
    font-size: 15px;
    color: var(--ink-espresso);
  }
  .cam-label-option.active { color: var(--copper-mid); }
  .cam-error {
    padding: 10px 14px;
    color: var(--amber);
    font-size: 13px;
  }
`;
