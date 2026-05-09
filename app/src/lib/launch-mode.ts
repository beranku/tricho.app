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
 * 0. **Dev-only bypass** — see {@link isDevEnvironment}. When the
 *    browser is on a dev/preview origin AND the page URL contains
 *    `?tricho-dev-force-pwa-mode=1` (or the localStorage flag is set
 *    from a prior visit), this returns `pwa` without an actual install.
 *    Lets us debug the post-install flow in a regular browser tab. The
 *    hostname allowlist makes the flag a no-op on `tricho.app` (prod).
 * 1. `display-mode: standalone` — the modern matchMedia query supported
 *    by Android Chrome and iOS Safari ≥ 11.3.
 * 2. `navigator.standalone` — the legacy iOS Safari flag (≤ 11.2). Still
 *    set on current iOS for historical reasons; harmless to keep.
 *
 * Anything that throws (SSR, no `window`) is treated as `browser`.
 */
export function detectLaunchMode(): LaunchMode {
  if (typeof window === 'undefined') return 'browser';

  if (isDevEnvironment()) {
    // One-shot URL activation: `?tricho-dev-force-pwa-mode=1` flips on the
    // localStorage flag, then we strip the query param so future reloads
    // keep the bypass without polluting the URL bar. Each step is in its
    // own try/catch so a hostile URL or a Safari Private Mode localStorage
    // throw can't block the localStorage-flag check below.
    try {
      const params = new URL(window.location.href).searchParams;
      if (params.get('tricho-dev-force-pwa-mode') === '1') {
        window.localStorage?.setItem('tricho-dev-force-pwa-mode', '1');
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete('tricho-dev-force-pwa-mode');
          window.history.replaceState(null, '', url.toString());
        } catch {
          // history.replaceState may fail if `window.location` was stubbed
          // by a test runner; harmless, the flag is already persisted.
        }
      }
    } catch {
      // URL parsing or localStorage access threw — skip URL activation.
    }
    try {
      if (window.localStorage?.getItem('tricho-dev-force-pwa-mode') === '1') {
        // Loud-but-not-fatal so the developer can confirm the bypass is active.
        // eslint-disable-next-line no-console
        console.warn('[tricho:dev] launch-mode forced to "pwa" via localStorage flag (clear with: localStorage.removeItem("tricho-dev-force-pwa-mode"))');
        return 'pwa';
      }
    } catch {
      // Safari Private Mode can refuse localStorage; fall through.
    }
  }

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
 * Allowlist of hostnames where the dev-only bypass is permitted to fire.
 * `tricho.app` (production) is intentionally absent — even a malicious URL
 * with the activation param does nothing on prod.
 */
function isDevEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return (
    host === 'dev.tricho.app' ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.tricho.pages.dev') // CF Pages PR previews
  );
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
