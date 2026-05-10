import { test, expect } from '@playwright/test';
import { openTwoDevices, teardownDevices } from './fixtures/cross-device';
import {
  writeCustomerOn,
  editCustomerOn,
  readCustomerOn,
  waitForCustomerOn,
} from './fixtures/sync-flows';

// Two-way real-time propagation: Device A writes a customer that Device B
// observes; Device B edits a field that Device A observes back.

test('A writes → B reads, B edits → A reads back', async ({ browser }) => {
  const devices = await openTwoDevices(browser);
  try {
    const wrote = await writeCustomerOn(devices.deviceA.page, {
      firstName: 'Anna',
      lastName: 'Realtime',
      phone: '+420 600 100 100',
    });

    // Poll Device B until it can decrypt + read the doc.
    let onB: { firstName: string } | null = null;
    for (let i = 0; i < 60 && onB?.firstName !== 'Anna'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      onB = await readCustomerOn<{ firstName: string }>(devices.deviceB.page, wrote.id);
    }
    expect(onB?.firstName).toBe('Anna');

    await editCustomerOn(devices.deviceB.page, wrote.id, { phone: '+420 600 100 200' });

    let onA: { phone: string } | null = null;
    for (let i = 0; i < 60 && onA?.phone !== '+420 600 100 200'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      onA = await readCustomerOn<{ phone: string }>(devices.deviceA.page, wrote.id);
    }
    expect(onA?.phone).toBe('+420 600 100 200');

    // Sanity: also assert direct reads converge.
    const finalB = await readCustomerOn<{ phone: string }>(devices.deviceB.page, wrote.id);
    expect(finalB?.phone).toBe('+420 600 100 200');
  } finally {
    await teardownDevices(devices);
  }
});
