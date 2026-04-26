// SW update detection + user-controlled application.
//
// The PWA registers /app/sw.js with `registerType: 'prompt'` and
// `skipWaiting: false` (see astro.config.mjs). When a new SW finishes
// installing, it sits as `registration.waiting` until something explicitly
// posts `{ type: 'SKIP_WAITING' }` to it. The Layout's inline registration
// script dispatches a `sw-waiting-change` window event whenever waiting
// state flips; this module turns that signal into a nanostore the React
// tree can subscribe to via `<UpdateBanner>`.
//
// The contract from `app-release-versioning` spec: never auto-skip. The
// user sees a banner, taps it, the new SW takes over, the page reloads.
// This avoids racing with the in-memory DEK during an active session.

import { atom } from 'nanostores';

export const swUpdate$ = atom<{ waiting: boolean }>({ waiting: false });

if (typeof window !== 'undefined') {
  window.addEventListener('sw-waiting-change', ((ev: Event) => {
    const detail = (ev as CustomEvent<{ waiting: boolean }>).detail;
    swUpdate$.set({ waiting: !!detail?.waiting });
  }) as EventListener);
}

/**
 * Apply a pending SW update: post SKIP_WAITING to the waiting worker, wait
 * for it to take control, then reload. Safe to call when no update is
 * pending — it no-ops gracefully.
 */
export async function applyUpdate(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration('/app/');
  if (!reg?.waiting) return;
  // Reload exactly once when controllerchange fires.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  reg.waiting.postMessage({ type: 'SKIP_WAITING' });
}
