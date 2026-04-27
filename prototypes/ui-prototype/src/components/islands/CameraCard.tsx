import { useState, useRef, useEffect } from 'react';
import { PHOTO_LABEL_DISPLAY, type PhotoLabel } from '../../lib/types/photo';

interface CameraCardProps {
  /** Default label */
  defaultLabel?: PhotoLabel;
  /** Callback when user taps capture button */
  onCapture?: (label: PhotoLabel) => void;
}

/**
 * Camera card: fake live preview, corner icons (flash, UV), label dropdown,
 * capture button (iOS dual-ring style).
 *
 * V1 placeholder — skutečné getUserMedia / capture pipeline přijde v next cycle.
 */
export function CameraCard({ defaultLabel = 'temeno-detail', onCapture }: CameraCardProps) {
  const [label, setLabel] = useState<PhotoLabel>(defaultLabel);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [menuOpen]);

  const handleSelect = (l: PhotoLabel) => {
    setLabel(l);
    setMenuOpen(false);
  };

  const labels: PhotoLabel[] = ['celek', 'temeno-detail', 'vlasova-linie', 'spanky'];

  return (
    <div className="cam-card">
      <div className="cam-preview">
        <div className="cam-corner left" aria-label="Blesk">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13 2 L4 13 H11 L10 22 L20 11 H13 L13 2 Z" />
          </svg>
        </div>
        <div className="cam-corner right" aria-label="UV režim">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12 C 4 7 8 5 12 5 C 16 5 20 7 22 12 C 20 17 16 19 12 19 C 8 19 4 17 2 12 Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>

        <div ref={wrapRef} className="cam-label-wrap">
          <button
            type="button"
            className="cam-label"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
            aria-expanded={menuOpen}
          >
            <span>{PHOTO_LABEL_DISPLAY[label]}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
              <path d="M5 7 L1 3 L9 3 Z" />
            </svg>
          </button>
          {menuOpen && (
            <div className="cam-menu" role="menu">
              {labels.map(l => (
                <button
                  key={l}
                  type="button"
                  role="menuitem"
                  onClick={() => handleSelect(l)}
                >
                  {PHOTO_LABEL_DISPLAY[l]}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="cam-hint ty-cam-hint">Namiřte na pokožku</div>

        <button
          type="button"
          className="cam-capture"
          aria-label="Pořídit snímek"
          onClick={() => onCapture?.(label)}
        >
          <span className="cam-capture-ring" />
          <span className="cam-capture-dot" />
        </button>
      </div>

      <style>{`
        .cam-card { padding: 0 20px 20px; }
        .cam-preview {
          position: relative;
          aspect-ratio: 4 / 3;
          background: linear-gradient(160deg, #2A2420 0%, #1A1612 100%);
          border-radius: var(--radius-panel);
          overflow: hidden;
        }
        .cam-corner {
          position: absolute;
          top: 12px;
          width: 36px; height: 36px;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(8px);
          border-radius: 50%;
          color: #F5EDE0;
          z-index: 2;
        }
        .cam-corner.left { left: 12px; }
        .cam-corner.right { right: 12px; }

        .cam-label-wrap {
          position: absolute;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 3;
        }
        .cam-label {
          display: flex; align-items: center; gap: 6px;
          padding: 7px 12px 7px 14px;
          background: rgba(0, 0, 0, 0.45);
          backdrop-filter: blur(8px);
          color: #F5EDE0;
          border: none;
          border-radius: 16px;
          font-family: 'Geist', sans-serif;
          font-size: 12px; font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
        }
        .cam-menu {
          position: absolute;
          top: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 12px;
          box-shadow: var(--card-shadow);
          overflow: hidden;
          min-width: 160px;
        }
        .cam-menu button {
          display: block;
          width: 100%;
          padding: 10px 14px;
          background: transparent;
          border: none;
          text-align: left;
          font-family: 'Geist', sans-serif;
          font-size: 13px;
          color: var(--ink);
          cursor: pointer;
        }
        .cam-menu button:hover, .cam-menu button:active {
          background: var(--surface-2);
        }
        .cam-hint {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, calc(-50% - 32px));
          text-align: center;
          pointer-events: none;
          z-index: 1;
        }
        .cam-capture {
          position: absolute;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          width: 62px; height: 62px;
          border: none;
          background: transparent;
          cursor: pointer;
          z-index: 5;
          padding: 0;
        }
        .cam-capture-ring {
          position: absolute;
          inset: 0;
          border: 3px solid #F5EDE0;
          border-radius: 50%;
        }
        .cam-capture-dot {
          position: absolute;
          inset: 6px;
          background: #F5EDE0;
          border-radius: 50%;
        }
        .cam-capture:active .cam-capture-dot {
          transform: scale(0.92);
          transition: transform 0.1s;
        }
      `}</style>
    </div>
  );
}
