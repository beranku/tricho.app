/**
 * PWA launch-mode and browser-family detection used by the welcome wizard.
 *
 * Both functions read live `window` / `navigator` state on every call.
 * The result MUST NOT be persisted: uninstalling the PWA must put the user
 * back on Step 1, which only works if the wizard re-detects the mode at
 * every mount.
 */

export type LaunchMode = 'browser' | 'pwa';
export type BrowserFamily = 'ios' | 'android' | 'other';

/**
 * Detect whether the current document was opened from an installed PWA
 * (`pwa`) or from a regular browser tab (`browser`).
 *
 * Order of checks:
 * 1. `display-mode: standalone` — the modern matchMedia query supported
 *    by Android Chrome and iOS Safari ≥ 11.3.
 * 2. `navigator.standalone` — the legacy iOS Safari flag (≤ 11.2). Still
 *    set on current iOS for historical reasons; harmless to keep.
 *
 * Anything that throws (SSR, no `window`) is treated as `browser`.
 */
export function detectLaunchMode(): LaunchMode {
  if (typeof window === 'undefined') return 'browser';
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return 'pwa';
  } catch {
    // matchMedia missing or threw — fall through.
  }
  if ((window.navigator as { standalone?: boolean } | undefined)?.standalone === true) {
    return 'pwa';
  }
  return 'browser';
}

/**
 * Detect the user-agent family for picking install instructions in
 * Step 1. UA sniffing is brittle in general; here it only chooses between
 * three strings, so the cost of a misclassification is showing the
 * `other` fallback ("open the browser menu, find Install"). That is
 * benign and recoverable.
 */
export function detectBrowser(): BrowserFamily {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent ?? '';
  if (/iPad|iPhone|iPod/.test(ua) && !(window as { MSStream?: unknown }).MSStream) {
    return 'ios';
  }
  if (/Android/.test(ua)) return 'android';
  return 'other';
}
