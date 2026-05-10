import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createVaultWithRs, joinVaultWithRs, type CreatedVault } from './unlock';
import { grandfatherFreeDevices } from './admin';

const E2E_BRIDGE_KEY = 'tricho-e2e-bridge';

export interface DeviceHandle {
  context: BrowserContext;
  page: Page;
}

export interface TwoDevices {
  deviceA: DeviceHandle & { recoverySecret: string };
  deviceB: DeviceHandle;
  sub: string;
  vaultId: string;
  recoverySecret: string;
  username: string;
}

/**
 * Boot Device A (creates vault, registers passkey via virtual authenticator,
 * unlocks) and Device B (signs in as the same `sub`, lands on JoinVaultScreen,
 * unlocks with the same RS). Both contexts opt in to the AppShell test bridge
 * so callers can drive customer CRUD and observe sync events without coupling
 * to UI selectors.
 */
export async function openTwoDevices(browser: Browser, opts: { sub?: string } = {}): Promise<TwoDevices> {
  const sub = opts.sub ?? `e2e-cd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const contextA = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(contextA);
  const pageA = await contextA.newPage();
  const created: CreatedVault = await createVaultWithRs(pageA, { sub });

  // Wait until the AppShell wires up the bridge so further calls have it.
  const vaultIdA = await waitForBridge(pageA);

  // Free tier deviceLimit defaults to 1 server-side. Grandfather this user
  // to lift it to 2 so Device B's OAuth callback approves; this matches the
  // historical "free users keep two devices" behaviour the cross-device
  // walks were designed against.
  await grandfatherFreeDevices(created.user.couchdbUsername);

  // Make sure Device A has finished pushing its `vault-state` doc to
  // CouchDB before Device B's wizard probes. Without this, B's flow probe
  // races with A's first sync and falls back to the new-flow card.
  await pageA.evaluate(
    (timeoutMs) =>
      new Promise<void>((resolve, reject) => {
        const w = window as unknown as {
          __trichoE2E?: {
            subscribeSyncEvents: (cb: (s: { status: string }) => void) => () => void;
          };
        };
        if (!w.__trichoE2E) return reject(new Error('bridge not ready'));
        let unsub: (() => void) | null = null;
        const timer = setTimeout(() => {
          unsub?.();
          reject(new Error(`waitForSyncPaused: timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        unsub = w.__trichoE2E.subscribeSyncEvents((s) => {
          if (s.status === 'paused') {
            clearTimeout(timer);
            unsub?.();
            resolve();
          }
        });
      }),
    30_000,
  );

  const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(contextB);
  const pageB = await contextB.newPage();
  await joinVaultWithRs(pageB, { sub, recoverySecret: created.recoverySecret });
  const vaultIdB = await waitForBridge(pageB);

  expect(vaultIdA, 'devices must share vaultId for kid to match').toBe(vaultIdB);

  return {
    deviceA: { context: contextA, page: pageA, recoverySecret: created.recoverySecret },
    deviceB: { context: contextB, page: pageB },
    sub,
    vaultId: vaultIdA,
    recoverySecret: created.recoverySecret,
    username: created.user.couchdbUsername,
  };
}

export async function enableTestBridge(context: BrowserContext): Promise<void> {
  await context.addInitScript((key) => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* noop */
    }
  }, E2E_BRIDGE_KEY);
}

/**
 * Block until window.__trichoE2E is present and return the bridge's vaultId.
 */
export async function waitForBridge(page: Page, timeoutMs = 15_000): Promise<string> {
  return page.waitForFunction(
    () => {
      const w = window as unknown as { __trichoE2E?: { vaultId: string } };
      return w.__trichoE2E?.vaultId ?? null;
    },
    null,
    { timeout: timeoutMs },
  ).then((handle) => handle.jsonValue() as Promise<string>);
}

/**
 * Wait until `docId` is observable on `page` (i.e. `__trichoE2E.getCustomer`
 * returns a non-null value). PouchDB's `paused` event can fire before the
 * doc is queryable — we poll directly until the read returns a value.
 */
export async function waitForSyncedDoc(
  page: Page,
  opts: { docId: string; timeoutMs?: number },
): Promise<void> {
  const { docId, timeoutMs = 30_000 } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const got = await page.evaluate(async (id) => {
      const w = window as unknown as {
        __trichoE2E?: { getCustomer?: (id: string) => Promise<Record<string, unknown> | null> };
      };
      if (!w.__trichoE2E?.getCustomer) return null;
      return w.__trichoE2E.getCustomer(id);
    }, docId);
    if (got != null) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`waitForSyncedDoc(${docId}): timeout after ${timeoutMs}ms`);
}

export async function teardownDevices(devices: TwoDevices): Promise<void> {
  await devices.deviceA.context.close().catch(() => void 0);
  await devices.deviceB.context.close().catch(() => void 0);
}
