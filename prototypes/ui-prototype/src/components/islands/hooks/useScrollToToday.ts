import { useEffect, useCallback, type RefObject } from 'react';
import { todayPosition, type TodayPosition } from '../../../lib/store/phoneScroll';

const STICKY_TOP = 46;
const HEADER_HEIGHT = 48;

/**
 * Tracks where the "today" section is relative to the visible scroll viewport,
 * writes it into the `todayPosition` nanostore (subscribed by FabSecondary),
 * and returns a `scrollToToday` callback for programmatic return.
 */
export function useScrollToToday(
  scrollRef: RefObject<HTMLElement | null>
): { scrollToToday: () => void } {
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const todaySection = scrollEl.querySelector<HTMLElement>('[data-today="true"]');
    if (!todaySection) return;

    const update = () => {
      const scrollRect = scrollEl.getBoundingClientRect();
      const todayRect = todaySection.getBoundingClientRect();
      const topOffset = todayRect.top - scrollRect.top;
      const bottomOffset = todayRect.bottom - scrollRect.top;

      let position: TodayPosition;
      if (topOffset > STICKY_TOP) {
        // today hasn't reached sticky — user is in past
        position = 'past';
      } else if (bottomOffset <= STICKY_TOP + HEADER_HEIGHT) {
        // today scrolled completely past — user is in future
        position = 'future';
      } else {
        position = 'in-view';
      }

      if (todayPosition.get() !== position) {
        todayPosition.set(position);
      }
    };

    scrollEl.addEventListener('scroll', update, { passive: true });
    update();

    return () => scrollEl.removeEventListener('scroll', update);
  }, [scrollRef]);

  const scrollToToday = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const todaySection = scrollEl.querySelector<HTMLElement>('[data-today="true"]');
    if (!todaySection) return;

    const scrollRect = scrollEl.getBoundingClientRect();
    const todayRect = todaySection.getBoundingClientRect();
    const delta = todayRect.top - scrollRect.top - STICKY_TOP;
    scrollEl.scrollBy({ top: delta, behavior: 'smooth' });
  }, [scrollRef]);

  return { scrollToToday };
}
