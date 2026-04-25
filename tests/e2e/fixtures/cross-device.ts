import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createVaultWithRs, joinVaultWithRs, type CreatedVault } from './unlock';

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
 * Wait for a specific document id to be observed by Device B's sync listener:
 * a `change` event followed by a `paused` event. No sleeps, no polling on the
 * test side — we register a sync subscriber inside the page that resolves a
 * promise on the right event sequence.
 */
export async function waitForSyncedDoc(
  page: Page,
  opts: { docId: string; timeoutMs?: number },
): Promise<void> {
  const { docId, timeoutMs = 20_000 } = opts;
  await page.evaluate(
    ({ docId, timeoutMs }) => {
      const w = window as unknown as {
        __trichoE2E?: {
          subscribeSyncEvents: (cb: (s: { status: string; pulled: number }) => void) => () => void;
        };
      };
      if (!w.__trichoE2E) throw new Error('test bridge not ready');
      return new Promise<void>((resolve, reject) => {
        let sawChange = false;
        const timer = setTimeout(() => {
          unsub();
          reject(new Error(`waitForSyncedDoc(${docId}): timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        const unsub = w.__trichoE2E!.subscribeSyncEvents((s) => {
          if (s.status === 'syncing' && s.pulled > 0) sawChange = true;
          if (sawChange && s.status === 'paused') {
            clearTimeout(timer);
            unsub();
            resolve();
          }
        });
      });
    },
    { docId, timeoutMs },
  );
}

export async function teardownDevices(devices: TwoDevices): Promise<void> {
  await devices.deviceA.context.close().catch(() => void 0);
  await devices.deviceB.context.close().catch(() => void 0);
}
