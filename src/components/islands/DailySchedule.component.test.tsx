import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { DailySchedule } from './DailySchedule';
import { putEncrypted, closeVaultDb, type VaultDb } from '../../db/pouch';
import { inMemoryPouch } from '../../test/fixtures/pouch';
import { makeVaultFixture } from '../../test/fixtures/vault';
import { DOC_TYPES, type AppointmentData, type CustomerData } from '../../db/types';
import { phoneScrollStore } from '../../lib/store/phoneScroll';

const HOUR = 60 * 60_000;

describe('DailySchedule', () => {
  let db: VaultDb;
  let vaultId: string;

  beforeEach(async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const fixture = await makeVaultFixture();
    vaultId = fixture.vaultId;
    db = await inMemoryPouch(fixture);
    act(() => phoneScrollStore.set({ stuckDay: null, todayInView: true, todayDirection: null }));
  });

  afterEach(async () => {
    cleanup();
    await closeVaultDb();
  });

  async function seedCustomer(id: string, firstName: string, lastName: string): Promise<void> {
    const data: CustomerData = { firstName, lastName, createdAt: 0 };
    await putEncrypted<CustomerData>(db, {
      _id: id,
      type: DOC_TYPES.CUSTOMER,
      updatedAt: Date.now(),
      deleted: false,
      data,
    });
  }

  async function seedAppointment(opts: {
    id: string;
    customerId: string;
    startAt: number;
    endAt: number;
    serviceLabel?: string;
    status?: AppointmentData['status'];
  }): Promise<void> {
    const data: AppointmentData = {
      customerId: opts.customerId,
      startAt: opts.startAt,
      endAt: opts.endAt,
      serviceLabel: opts.serviceLabel ?? 'Diagnostika',
      status: opts.status ?? 'scheduled',
      createdAt: 0,
    };
    await putEncrypted<AppointmentData>(db, {
      _id: opts.id,
      type: DOC_TYPES.APPOINTMENT,
      updatedAt: Date.now(),
      deleted: false,
      data,
    });
  }

  it('renders a 7-day window of sections', async () => {
    render(<DailySchedule db={db} />);
    await waitFor(() => {
      const sections = document.querySelectorAll('section[data-day]');
      expect(sections.length).toBe(7);
    });
    expect(document.querySelector('[data-today="true"]')).toBeInTheDocument();
  });

  it('renders today appointments with customer name + service', async () => {
    const today = new Date();
    today.setHours(10, 0, 0, 0);
    await seedCustomer('customer:1', 'Klára', 'Dvořáková');
    await seedAppointment({
      id: 'appointment:a',
      customerId: 'customer:1',
      startAt: today.getTime(),
      endAt: today.getTime() + HOUR,
      serviceLabel: 'Diagnostika',
    });

    render(<DailySchedule db={db} />);
    await waitFor(() => expect(screen.getByText('Klára Dvořáková')).toBeInTheDocument());
    expect(screen.getByText('Diagnostika')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
  });

  it('synthesises free slots in gaps within business hours for today', async () => {
    const today = new Date();
    today.setHours(10, 0, 0, 0);
    await seedCustomer('customer:1', 'A', 'A');
    await seedAppointment({
      id: 'appointment:a',
      customerId: 'customer:1',
      startAt: today.getTime(),
      endAt: today.getTime() + HOUR,
    });
    render(<DailySchedule db={db} />);
    // Free slot rendered as Patrick-Hand "volno X" prose.
    await waitFor(() => expect(screen.getAllByText(/volno/i).length).toBeGreaterThan(0));
  });

  it('renders the empty-state placeholder when there are no appointments', async () => {
    render(<DailySchedule db={db} />);
    // Empty-state copy now comes from `m.menu_promo_body()` (cs):
    // "Otevřete plán a prohlížejte detaily klientů."
    await waitFor(() =>
      expect(screen.getByText(/Otevřete plán/i)).toBeInTheDocument(),
    );
  });

  it('renders the primary FAB and the secondary scroll-to-today FAB', async () => {
    render(<DailySchedule db={db} />);
    // Primary FAB aria-label = `m.schedule_addAppointment()` (cs ⇒ "Přidat termín")
    // Secondary FAB aria-label = `m.schedule_scrollToTodayLabel()` (cs ⇒ "Zpět na dnešek")
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Přidat termín/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Zpět na dnešek/i })).toBeInTheDocument();
  });
});

// Suppress vaultId-unused TS warning at the module level.
void DailySchedule;
