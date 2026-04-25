import { useEffect, type RefObject } from 'react';

/**
 * Attaches a scroll listener to `scrollRef` and toggles `.stuck` on all
 * `.dv-a-wrap` elements inside it when they reach the sticky top threshold.
 *
 * Runs on every scroll event (passive) and once on mount. Cleanup removes
 * the listener.
 */
export function useStuckState(
  scrollRef: RefObject<HTMLElement | null>,
  stickyTop: number = 46
): void {
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const wraps = scrollEl.querySelectorAll<HTMLElement>('.dv-a-wrap');
    if (!wraps.length) return;

    const update = () => {
      const scrollRect = scrollEl.getBoundingClientRect();
      wraps.forEach((wrap) => {
        const rect = wrap.getBoundingClientRect();
        const topOffset = rect.top - scrollRect.top;
        const isStuck = topOffset <= stickyTop + 1;
        wrap.classList.toggle('stuck', isStuck);
      });
    };

    scrollEl.addEventListener('scroll', update, { passive: true });
    update(); // initial state

    return () => scrollEl.removeEventListener('scroll', update);
  }, [scrollRef, stickyTop]);
}
