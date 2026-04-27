import { useStore } from '@nanostores/react';
import { todayPosition } from '../../lib/store/phoneScroll';

/**
 * Scroll-to-today FAB — vlevo dole. Viditelný jen když user je mimo dnešní sekci.
 * Šipka ukazuje směr k dnešku (nahoru = dnešek je nad, dolů = dnešek je pod).
 *
 * Klik dispatchuje custom event, PhoneScroll island ho přijme a provede scroll.
 */
export function FabSecondary() {
  const position = useStore(todayPosition);
  const visible = position !== 'in-view';
  const directionDown = position === 'past'; // dnešek je pod tebou → šipka dolů

  const handleClick = () => {
    document.dispatchEvent(new CustomEvent('tricho:scroll-to-today'));
  };

  return (
    <button
      type="button"
      className={[
        'fab-secondary',
        visible ? 'visible' : '',
        directionDown ? 'direction-down' : ''
      ].filter(Boolean).join(' ')}
      onClick={handleClick}
      aria-label="Zpět na dnešek"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
    >
      <svg
        className="fab-arrow"
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 19 L12 5" />
        <path d="M6 11 L12 5 L18 11" />
      </svg>
    </button>
  );
}
