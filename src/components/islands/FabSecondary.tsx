/**
 * "Scroll to today" floating button — hidden when today is in view; shows
 * up/down arrow indicating which side today lives on.
 */
import { useStore } from '@nanostores/react';
import { phoneScrollStore } from '../../lib/store/phoneScroll';

export function FabSecondary(): JSX.Element {
  const { todayInView, todayDirection } = useStore(phoneScrollStore);
  const visible = !todayInView && todayDirection !== null;

  function scrollToToday(): void {
    const root = document.querySelector<HTMLElement>('.phone-scroll');
    const today = root?.querySelector<HTMLElement>('[data-today="true"]');
    if (today) today.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  return (
    <button
      type="button"
      className={`fab-secondary ${visible ? 'visible' : ''} direction-${todayDirection ?? 'up'}`}
      aria-label="Zpět na dnešek"
      onClick={scrollToToday}
    >
      <span className="fab-arrow" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6,12 12,6 18,12" />
          <line x1="12" y1="6" x2="12" y2="20" />
        </svg>
      </span>
      <style>{`
        .fab-secondary {
          position: absolute;
          bottom: calc(32px + env(safe-area-inset-bottom, 0px));
          left: 20px;
          width: 44px;
          height: 44px;
          border-radius: 22px;
          background: var(--surface);
          border: 1px solid var(--line);
          box-shadow: var(--card-shadow);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--ink-2);
          cursor: pointer;
          z-index: 16;
          opacity: 0;
          pointer-events: none;
          transform: translateY(4px) scale(0.9);
          transition: opacity var(--t-base), transform var(--t-base);
        }
        .fab-secondary.visible {
          opacity: 1;
          pointer-events: auto;
          transform: translateY(0) scale(1);
        }
        .fab-arrow {
          transition: transform var(--t-base);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .direction-down .fab-arrow {
          transform: rotate(180deg);
        }
      `}</style>
    </button>
  );
}
