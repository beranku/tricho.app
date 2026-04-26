// TODO: PRF unlock variant of every test in this file. Today's virtual
// authenticator registers a passkey but does not reliably emit a PRF result;
// the RS unlock path covers the same crypto primitives end-to-end. See
// openspec change e2e-sync-encryption-tests, design D3.
import { test, expect } from '@playwright/test';
import { joinVaultWithRs, createVaultWithRs } from './fixtures/unlock';
import {
  enableTestBridge,
  openTwoDevices,
  teardownDevices,
  waitForBridge,
  waitForSyncedDoc,
} from './fixtures/cross-device';
import { adminFindDocId, adminGet, adminPut, userDbHexFor, closeAdmin } from './fixtures/admin';

test.afterAll(async () => {
  await closeAdmin();
});

test('Device B joins via Recovery Secret and reads what Device A wrote', async ({ browser }) => {
  const devices = await openTwoDevices(browser);
  try {
    const wrote = await devices.deviceA.page.evaluate(async () => {
      const w = window as unknown as {
        __trichoE2E: {
          putCustomer: (data: Record<string, unknown>) => Promise<{ id: string; rev: string }>;
        };
      };
      return w.__trichoE2E.putCustomer({
        firstName: 'Anna',
        lastName: 'Cross-Device',
        phone: '+420 600 000 001',
      });
    });

    await waitForSyncedDoc(devices.deviceB.page, { docId: wrote.id });

    const readOnB = await devices.deviceB.page.evaluate(async (id) => {
      const w = window as unknown as {
        __trichoE2E: { getCustomer: (id: string) => Promise<Record<string, unknown> | null> };
      };
      return w.__trichoE2E.getCustomer(id);
    }, wrote.id);

    expect(readOnB).toMatchObject({
      firstName: 'Anna',
      lastName: 'Cross-Device',
      phone: '+420 600 000 001',
    });
  } finally {
    await teardownDevices(devices);
  }
});

test('Wrong Recovery Secret on Device B never produces a usable DEK', async ({ browser }) => {
  const sub = `e2e-cd-wrong-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Device A creates the vault and writes a customer with sensitive plaintext.
  const ctxA = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(ctxA);
  const pageA = await ctxA.newPage();
  const { recoverySecret } = await createVaultWithRs(pageA, { sub });
  await waitForBridge(pageA);

  const wrote = await pageA.evaluate(async () => {
    const w = window as unknown as {
      __trichoE2E: {
        putCustomer: (data: Record<string, unknown>) => Promise<{ id: string; rev: string }>;
      };
    };
    return w.__trichoE2E.putCustomer({
      firstName: 'Petra',
      lastName: 'OnlyOnA',
      phone: '+420 600 000 002',
      notes: 'PII-DO-NOT-LEAK',
    });
  });
  // Wait for the doc to make it to the server before Device B attempts.
  await pageA.evaluate(
    ({ id, timeoutMs }) =>
      new Promise<void>((resolve, reject) => {
        const w = window as unknown as {
          __trichoE2E: {
            subscribeSyncEvents: (cb: (s: { status: string; pushed: number }) => void) => () => void;
          };
        };
        let pushed = false;
        const timer = setTimeout(() => {
          unsub();
          reject(new Error(`push of ${id} did not settle in ${timeoutMs}ms`));
        }, timeoutMs);
        const unsub = w.__trichoE2E.subscribeSyncEvents((s) => {
          if (s.status === 'syncing' && s.pushed > 0) pushed = true;
          if (pushed && s.status === 'paused') {
            clearTimeout(timer);
            unsub();
            resolve();
          }
        });
      }),
    { id: wrote.id, timeoutMs: 20_000 },
  );

  // Device B tries to join with a deliberately wrong RS (flip one char of the valid one).
  const wrongRs = mutateOneChar(recoverySecret);

  const ctxB = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(ctxB);
  const pageB = await ctxB.newPage();

  // Track every response body B sees so we can assert no plaintext leaked
  // in any HTTP response payload.
  const responseBodies: string[] = [];
  pageB.on('response', async (resp) => {
    if (resp.url().includes('/userdb-')) {
      try {
        responseBodies.push(await resp.text());
      } catch {
        /* binary or already-consumed; ignore */
      }
    }
  });

  await expect(
    joinVaultWithRs(pageB, { sub, recoverySecret: wrongRs }),
  ).rejects.toThrow();

  // The join screen should still be visible with an error region.
  await expect(pageB.locator('#join-rs-input, [id="join-rs-input"]').first()).toBeVisible();

  // No customer plaintext on B.
  const customerCount = await pageB.evaluate(async () => {
    const w = window as unknown as {
      __trichoE2E?: { listCustomers: () => Promise<unknown[]> };
    };
    if (!w.__trichoE2E) return 0; // bridge not present → vault never opened
    const list = await w.__trichoE2E.listCustomers();
    return list.length;
  });
  expect(customerCount).toBe(0);

  // No plaintext in any sync response body B fetched.
  for (const body of responseBodies) {
    expect(body).not.toContain('Petra');
    expect(body).not.toContain('OnlyOnA');
    expect(body).not.toContain('PII-DO-NOT-LEAK');
  }

  await ctxA.close();
  await ctxB.close();
});

test('write on A is read on B (live propagation)', async ({ browser }) => {
  const devices = await openTwoDevices(browser);
  try {
    const wrote = await devices.deviceA.page.evaluate(async () => {
      const w = window as unknown as {
        __trichoE2E: {
          putCustomer: (data: Record<string, unknown>) => Promise<{ id: string; rev: string }>;
        };
      };
      return w.__trichoE2E.putCustomer({
        firstName: 'A→B',
        lastName: 'Direction',
        phone: '+420 600 000 010',
      });
    });
    await waitForSyncedDoc(devices.deviceB.page, { docId: wrote.id });
    const readOnB = await devices.deviceB.page.evaluate(async (id) => {
      const w = window as unknown as {
        __trichoE2E: { getCustomer: (id: string) => Promise<Record<string, unknown> | null> };
      };
      return w.__trichoE2E.getCustomer(id);
    }, wrote.id);
    expect(readOnB).toMatchObject({ firstName: 'A→B', lastName: 'Direction', phone: '+420 600 000 010' });
  } finally {
    await teardownDevices(devices);
  }
});

test('write on B is read on A (live propagation, reverse direction)', async ({ browser }) => {
  const devices = await openTwoDevices(browser);
  try {
    const wrote = await devices.deviceB.page.evaluate(async () => {
      const w = window as unknown as {
        __trichoE2E: {
          putCustomer: (data: Record<string, unknown>) => Promise<{ id: string; rev: string }>;
        };
      };
      return w.__trichoE2E.putCustomer({
        firstName: 'B→A',
        lastName: 'Direction',
        phone: '+420 600 000 011',
      });
    });
    await waitForSyncedDoc(devices.deviceA.page, { docId: wrote.id });
    const readOnA = await devices.deviceA.page.evaluate(async (id) => {
      const w = window as unknown as {
        __trichoE2E: { getCustomer: (id: string) => Promise<Record<string, unknown> | null> };
      };
      return w.__trichoE2E.getCustomer(id);
    }, wrote.id);
    expect(readOnA).toMatchObject({ firstName: 'B→A', lastName: 'Direction', phone: '+420 600 000 011' });
  } finally {
    await teardownDevices(devices);
  }
});

test('flipped ciphertext byte produces an AEAD error on Device B', async ({ browser }) => {
  const devices = await openTwoDevices(browser);
  try {
    // Device A writes a doc; wait until it lands on the server so we can mutate it.
    const wrote = await devices.deviceA.page.evaluate(async () => {
      const w = window as unknown as {
        __trichoE2E: {
          putCustomer: (data: Record<string, unknown>) => Promise<{ id: string; rev: string }>;
        };
      };
      return w.__trichoE2E.putCustomer({
        firstName: 'Tamper',
        lastName: 'Target',
        phone: '+420 600 000 099',
      });
    });
    await waitForSyncedDoc(devices.deviceB.page, { docId: wrote.id });

    const dbHex = userDbHexFor(devices.username);
    const row = await adminGet<Record<string, unknown> & {
      _rev: string;
      payload: { v: number; alg: string; kid: string; iv: string; ct: string };
    }>(`userdb-${dbHex}/${wrote.id}`);

    // Flip one byte of the base64url ciphertext (preserve length + alphabet).
    const tamperedCt = flipOneBase64UrlChar(row.payload.ct);
    expect(tamperedCt).not.toBe(row.payload.ct);

    // Capture decrypt-channel errors from Device B's console for the assertion.
    const decryptErrors: string[] = [];
    const onConsole = (msg: import('@playwright/test').ConsoleMessage) => {
      if (msg.type() === 'error' || msg.type() === 'warning') decryptErrors.push(msg.text());
    };
    devices.deviceB.page.on('console', onConsole);

    await adminPut(`userdb-${dbHex}/${wrote.id}`, {
      ...row,
      payload: { ...row.payload, ct: tamperedCt },
    });

    // Force B to pull and attempt decrypt.
    const beforeCount = await listCustomerCount(devices.deviceB.page);
    await devices.deviceB.page.evaluate(
      ({ timeoutMs }) =>
        new Promise<void>((resolve) => {
          const w = window as unknown as {
            __trichoE2E: {
              subscribeSyncEvents: (cb: (s: { status: string; pulled: number }) => void) => () => void;
            };
          };
          let pulled = false;
          const timer = setTimeout(() => {
            unsub();
            resolve();
          }, timeoutMs);
          const unsub = w.__trichoE2E.subscribeSyncEvents((s) => {
            if (s.status === 'syncing' && s.pulled > 0) pulled = true;
            if (pulled && s.status === 'paused') {
              clearTimeout(timer);
              unsub();
              resolve();
            }
          });
        }),
      { timeoutMs: 15_000 },
    );

    // Trigger a decrypt by listing customers; the tampered doc must NOT
    // surface as a partially-decrypted entry. The reader is allowed to
    // either throw (and surface zero new customers) or skip the bad doc.
    const listOrError = await devices.deviceB.page.evaluate(async () => {
      const w = window as unknown as {
        __trichoE2E: { listCustomers: () => Promise<Array<{ id: string; data: Record<string, unknown> }>> };
      };
      try {
        return { ok: true as const, list: await w.__trichoE2E.listCustomers() };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    });

    devices.deviceB.page.off('console', onConsole);

    if (listOrError.ok) {
      // Tampered doc must not appear with a real plaintext shape.
      const tampered = listOrError.list.find((c) => c.id === wrote.id);
      // Either it's filtered out entirely, OR if it appears its data is not the
      // pre-tamper plaintext (because the AEAD-protected payload could not
      // decrypt to anything meaningful).
      expect(tampered?.data?.firstName === 'Tamper' && tampered?.data?.lastName === 'Target').not.toBe(
        true,
      );
      // The customer count should not have increased due to the tamper.
      expect(listOrError.list.length).toBeLessThanOrEqual(beforeCount);
    } else {
      expect(listOrError.error).toMatch(/AEAD|auth|decrypt|tag/i);
    }

    // Some path must have surfaced the failure (console or a thrown error).
    const seen = decryptErrors.join('\n') + (listOrError.ok ? '' : `\n${listOrError.error}`);
    expect(seen).toMatch(/(decrypt|AEAD|payload|auth)/i);
  } finally {
    await teardownDevices(devices);
  }
});

// Helpers --------------------------------------------------------------------

async function listCustomerCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as {
      __trichoE2E: { listCustomers: () => Promise<unknown[]> };
    };
    return (await w.__trichoE2E.listCustomers()).length;
  });
}

function mutateOneChar(rs: string): string {
  const chars = rs.split('');
  for (let i = 0; i < chars.length; i++) {
    if (/[A-Z2-7]/.test(chars[i]!)) {
      chars[i] = chars[i] === 'A' ? 'B' : 'A';
      return chars.join('');
    }
  }
  return rs + 'A';
}

function flipOneBase64UrlChar(ct: string): string {
  const chars = ct.split('');
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (/[A-Za-z0-9_-]/.test(c)) {
      chars[i] = c === 'A' ? 'B' : 'A';
      return chars.join('');
    }
  }
  return ct + 'A';
}
