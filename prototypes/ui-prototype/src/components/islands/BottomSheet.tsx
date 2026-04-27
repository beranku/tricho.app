import { type ReactNode } from 'react';
import { useBottomSheet } from './hooks/useBottomSheet';
import { useEscapeKey } from './hooks/useEscapeKey';

interface BottomSheetProps {
  /** Unique ID — used as nanostore key for open/close */
  id: string;
  /** Accessible label for dialog */
  label: string;
  children: ReactNode;
}

/**
 * Bottom sheet s backdropem, handle (drag close placeholder), ESC key listener.
 * Sliding animation via CSS .open class.
 *
 * Stateful: subscribes to `openSheetId` nanostore. Open/close volanou přes
 * `useBottomSheet(id).open()` / `close()`.
 */
export function BottomSheet({ id, label, children }: BottomSheetProps) {
  const { isOpen, close } = useBottomSheet(id);
  useEscapeKey(close, isOpen);

  return (
    <>
      <div
        className={`sheet-backdrop ${isOpen ? 'open' : ''}`}
        onClick={close}
        aria-hidden="true"
      />
      <div
        className={`sheet ${isOpen ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-hidden={!isOpen}
      >
        <button
          type="button"
          className="sheet-handle"
          onClick={close}
          aria-label="Zavřít"
        />
        {children}
      </div>

      <style>{`
        .sheet-backdrop {
          position: absolute;
          inset: 0;
          background: var(--backdrop);
          z-index: 20;
          opacity: 0;
          pointer-events: none;
          transition: opacity var(--t-sheet);
        }
        .sheet-backdrop.open {
          opacity: 1;
          pointer-events: auto;
        }
        .sheet {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: var(--surface);
          border-top-left-radius: var(--radius-panel);
          border-top-right-radius: var(--radius-panel);
          box-shadow: var(--sheet-shadow);
          z-index: 21;
          padding: 0 20px 24px;
          transform: translateY(100%);
          transition: transform var(--t-sheet) var(--ease-std);
          max-height: 80%;
          overflow-y: auto;
        }
        .sheet.open {
          transform: translateY(0);
        }
        .sheet-handle {
          display: block;
          width: 40px;
          height: 4px;
          background: var(--line);
          border: none;
          border-radius: 2px;
          margin: 10px auto 18px;
          cursor: pointer;
          padding: 0;
        }
      `}</style>
    </>
  );
}
