/**
 * Wraps the schedule's scrolling container. On mount: scroll today into view
 * (instant, no animation). Continuously: track which day-section's sticky
 * header is "stuck" and whether today is in view, publishing both to the
 * phoneScroll store.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { phoneScrollStore } from '../../lib/store/phoneScroll';

export interface PhoneScrollProps {
  children?: ReactNode;
  /** Add bottom padding so FAB doesn't cover the last appointment. */
  bottomGap?: number;
}

export function PhoneScroll({ children, bottomGap = 120 }: PhoneScrollProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    // 1) Scroll today into view on first paint.
    const today = root.querySelector<HTMLElement>('[data-today="true"]');
    if (today) {
      // Instant — explicit per spec, "no animation".
      today.scrollIntoView({ block: 'start' });
    }

    // 2) Observe every day-section's sticky header.
    const sections = Array.from(root.querySelectorAll<HTMLElement>('section[data-day]'));
    const visibility = new Map<string, IntersectionObserverEntry>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const day = entry.target.getAttribute('data-day');
          if (!day) continue;
          visibility.set(day, entry);
        }
        publish();
      },
      { root, threshold: [0, 0.01, 0.5, 1], rootMargin: '0px 0px -90% 0px' },
    );

    function publish(): void {
      let stuckDay: string | null = null;
      let topMost = Infinity;
      let todayInView = false;
      let todayDirection: 'up' | 'down' | null = null;

      for (const section of sections) {
        const day = section.dataset.day;
        if (!day) continue;
        const rect = section.getBoundingClientRect();
        const rootRect = root!.getBoundingClientRect();
        const relTop = rect.top - rootRect.top;
        if (relTop <= 50 && rect.bottom > rootRect.top + 50 && relTop < topMost) {
          topMost = relTop;
          stuckDay = day;
        }
        if (section.dataset.today === 'true') {
          if (rect.top < rootRect.bottom && rect.bottom > rootRect.top) {
            todayInView = true;
          } else {
            todayInView = false;
            todayDirection = rect.top < rootRect.top ? 'up' : 'down';
          }
        }
      }

      phoneScrollStore.set({ stuckDay, todayInView, todayDirection });
    }

    sections.forEach((s) => observer.observe(s));
    publish();

    const onScroll = (): void => publish();
    root.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      observer.disconnect();
      root.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div ref={ref} className="phone-scroll">
      <div className="scroll-topspacer" aria-hidden="true" />
      {children}
      <div className="scroll-bottomspacer" aria-hidden="true" style={{ height: bottomGap }} />
      <style>{`
        .phone-scroll {
          position: absolute;
          inset: 0;
          overflow-y: auto;
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: thin;
          scrollbar-color: var(--line) transparent;
        }
        .phone-scroll::-webkit-scrollbar { width: 3px; }
        .phone-scroll::-webkit-scrollbar-thumb { background: var(--line); border-radius: 3px; }
        .scroll-topspacer { height: 46px; flex-shrink: 0; }
        .scroll-bottomspacer { flex-shrink: 0; }
      `}</style>
    </div>
  );
}
