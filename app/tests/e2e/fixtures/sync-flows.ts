import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { enableTestBridge } from './cross-device';

// Helpers used by the sync-walkthrough specs. Centralises the
// `__trichoE2E.*` evaluate boilerplate so every walk reads the bridge
// through one shape. Tests MUST import from this module rather than
// reaching into the bridge directly.

export interface CustomerWriteResult {
  id: string;
  rev: string;
}

export async function writeCustomerOn(
  page: Page,
  data: Record<string, unknown>,
): Promise<CustomerWriteResult> {
  return page.evaluate(async (d) => {
    const w = window as unknown as {
      __trichoE2E?: {
        putCustomer?: (data: Record<string, unknown>) => Promise<CustomerWriteResult>;
      };
    };
    if (!w.__trichoE2E?.putCustomer) throw new Error('e2e bridge: putCustomer not available');
    return w.__trichoE2E.putCustomer(d);
  }, data);
}

export async function editCustomerOn(
  page: Page,
  id: string,
  patch: Record<string, unknown>,
): Promise<CustomerWriteResult> {
  return page.evaluate(
    async ({ id, patch }) => {
      const w = window as unknown as {
        __trichoE2E?: {
          updateCustomer?: (id: string, patch: Record<string, unknown>) => Promise<CustomerWriteResult>;
        };
      };
      if (!w.__trichoE2E?.updateCustomer) throw new Error('e2e bridge: updateCustomer not available');
      return w.__trichoE2E.updateCustomer(id, patch);
    },
    { id, patch },
  );
}

export async function readCustomerOn<T = Record<string, unknown>>(
  page: Page,
  id: string,
): Promise<T | null> {
  return page.evaluate(async (id) => {
    const w = window as unknown as {
      __trichoE2E?: { getCustomer?: (id: string) => Promise<unknown> };
    };
    if (!w.__trichoE2E?.getCustomer) throw new Error('e2e bridge: getCustomer not available');
    return (await w.__trichoE2E.getCustomer(id)) as unknown as T | null;
  }, id) as Promise<T | null>;
}

/**
 * Poll `getCustomer(id)` on `page` until the customer doc matches the
 * given key/value pairs (all must equal). Returns the matched doc.
 *
 * Implemented via a value-based match (instead of a serialised predicate
 * function) so the in-page handler stays self-contained and avoids
 * `new Function` round-trips that fight Playwright's serialiser.
 */
export async function waitForCustomerOn<T = Record<string, unknown>>(
  page: Page,
  id: string,
  match: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<T> {
  const handle = await page.waitForFunction(
    async ({ id, match }) => {
      const w = window as unknown as {
        __trichoE2E?: { getCustomer?: (id: string) => Promise<Record<string, unknown> | null> };
      };
      if (!w.__trichoE2E?.getCustomer) return null;
      const got = await w.__trichoE2E.getCustomer(id);
      if (got == null) return null;
      for (const [k, v] of Object.entries(match)) {
        if (got[k] !== v) return null;
      }
      return got;
    },
    { id, match },
    { timeout: timeoutMs },
  );
  return handle.jsonValue() as Promise<T>;
}

/**
 * Open a fresh, isolated browser context with the e2e bridge sentinel
 * already set. Encapsulates the `newContext + enableTestBridge + newPage`
 * triple used by every walk spec.
 */
export async function freshContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  return { context, page };
}

/**
 * Convenience: assert the bridge eventually sees a `paused` sync event,
 * which is the strongest "we're caught up" signal PouchDB emits without
 * deeper hooks.
 */
export async function waitForSyncPaused(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.evaluate(
    (timeoutMs) => {
      const w = window as unknown as {
        __trichoE2E?: {
          subscribeSyncEvents: (cb: (s: { status: string }) => void) => () => void;
        };
      };
      if (!w.__trichoE2E) throw new Error('e2e bridge not available');
      return new Promise<void>((resolve, reject) => {
        let unsub: (() => void) | null = null;
        const timer = setTimeout(() => {
          unsub?.();
          reject(new Error(`waitForSyncPaused: timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        unsub = w.__trichoE2E!.subscribeSyncEvents((s) => {
          if (s.status === 'paused') {
            clearTimeout(timer);
            unsub?.();
            resolve();
          }
        });
      });
    },
    timeoutMs,
  );
}

export { expect };
