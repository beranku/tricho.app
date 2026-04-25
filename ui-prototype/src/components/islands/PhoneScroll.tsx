import { useRef, useEffect, type ReactNode } from 'react';
import { useStuckState } from './hooks/useStuckState';
import { useScrollToToday } from './hooks/useScrollToToday';

interface PhoneScrollProps {
  children: ReactNode;
  /**
   * Has today section — enable scroll-to-today tracking and initial scroll.
   * Phone A (daily schedule) = true, Phone B (client detail) = false.
   */
  hasToday?: boolean;
}

/**
 * Main scroll container for phone content. Handles:
 * - Sticky day-divider stuck detection (.stuck class)
 * - Today position tracking (updates phoneScroll nanostore)
 * - Initial scroll to today on mount (if hasToday)
 *
 * Layout: absolute full-fill of phone-inner, overflow-y: auto.
 * Content passes through via `children` (Astro slots render as children).
 */
export function PhoneScroll({ children, hasToday = false }: PhoneScrollProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useStuckState(scrollRef);
  const { scrollToToday } = useScrollToToday(scrollRef);

  // Initial scroll to today on mount (no animation — silent positioning)
  useEffect(() => {
    if (!hasToday) return;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const todaySection = scrollEl.querySelector<HTMLElement>('[data-today="true"]');
    if (!todaySection) return;

    // rAF ensures layout is settled
    requestAnimationFrame(() => {
      const scrollRect = scrollEl.getBoundingClientRect();
      const todayRect = todaySection.getBoundingClientRect();
      const delta = todayRect.top - scrollRect.top - 46;
      scrollEl.scrollBy({ top: delta, behavior: 'auto' });
    });
  }, [hasToday]);

  // Expose scroll-to-today via window for FabSecondary click target.
  // Using event delegation for simplicity — FabSecondary dispatches custom event.
  useEffect(() => {
    const handler = () => scrollToToday();
    document.addEventListener('tricho:scroll-to-today', handler);
    return () => document.removeEventListener('tricho:scroll-to-today', handler);
  }, [scrollToToday]);

  return (
    <div className="phone-scroll" ref={scrollRef}>
      {children}
    </div>
  );
}

declare global {
  interface DocumentEventMap {
    'tricho:scroll-to-today': CustomEvent;
  }
}
