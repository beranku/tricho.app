/**
 * Bottom sheet — subscribes to sheetStore. Closes on backdrop tap or ESC.
 * Body-scroll lock + focus trap while open.
 *
 * Children render based on `sheet.type`. We accept a `renderers` prop so the
 * AppRoot can declare what each sheet type renders without this island
 * pulling in route-specific concerns.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useStore } from '@nanostores/react';
import { sheetStore, closeSheet } from '../../lib/store/sheet';

export interface BottomSheetProps {
  renderers: Partial<Record<'menu' | 'fab-add' | 'context', (payload?: { startAt?: number }) => ReactNode>>;
}

export function BottomSheet({ renderers }: BottomSheetProps): JSX.Element {
  const sheet = useStore(sheetStore);
  const sheetEl = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!sheet.open) return;

    previousFocus.current = document.activeElement as HTMLElement;

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSheet();
      }
      if (e.key === 'Tab') {
        const focusable = sheetEl.current?.querySelectorAll<HTMLElement>(
          'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);

    // Body-scroll lock — applied to the scroll container in the phone frame.
    const scrollEl = document.querySelector<HTMLElement>('.phone-scroll');
    const previousOverflow = scrollEl?.style.overflowY ?? '';
    if (scrollEl) scrollEl.style.overflowY = 'hidden';

    // Focus first interactive element in the sheet.
    requestAnimationFrame(() => {
      const first = sheetEl.current?.querySelector<HTMLElement>(
        'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    });

    return () => {
      document.removeEventListener('keydown', onKey);
      if (scrollEl) scrollEl.style.overflowY = previousOverflow;
      previousFocus.current?.focus?.();
    };
  }, [sheet.open]);

  const renderer = sheet.type ? renderers[sheet.type] : undefined;

  return (
    <>
      <div
        className={`sheet-backdrop ${sheet.open ? 'open' : ''}`}
        onClick={closeSheet}
        aria-hidden={!sheet.open}
      />
      <div
        ref={sheetEl}
        className={`sheet ${sheet.open ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!sheet.open}
      >
        <div className="sheet-handle" aria-hidden="true"></div>
        {sheet.open && renderer ? renderer(sheet.payload) : null}
      </div>
      <style>{`
        .sheet-backdrop {
          position: absolute;
          inset: 0;
          background: var(--backdrop);
          z-index: var(--z-backdrop);
          opacity: 0;
          pointer-events: none;
          transition: opacity var(--t-sheet);
          border-radius: 38px;
          backdrop-filter: blur(1px);
          -webkit-backdrop-filter: blur(1px);
        }
        .sheet-backdrop.open { opacity: 1; pointer-events: auto; }
        .sheet {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          background: var(--bg);
          border-top-left-radius: 26px;
          border-top-right-radius: 26px;
          padding: 8px 0 calc(20px + env(safe-area-inset-bottom, 0px));
          z-index: var(--z-sheet);
          transform: translateY(100%);
          transition: transform var(--t-sheet);
          box-shadow: var(--sheet-shadow);
          max-height: 82%;
          display: flex;
          flex-direction: column;
          border-top: 1px solid var(--line-soft);
        }
        .sheet.open { transform: translateY(0); }
        .sheet-handle {
          width: 40px;
          height: 5px;
          border-radius: 3px;
          background: var(--ink-4);
          margin: 8px auto 10px;
          flex-shrink: 0;
          opacity: 0.45;
          cursor: grab;
        }
      `}</style>
    </>
  );
}
