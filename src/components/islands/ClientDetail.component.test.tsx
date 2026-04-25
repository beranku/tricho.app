import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ClientDetail } from './ClientDetail';
import { putEncrypted, closeVaultDb, type VaultDb } from '../../db/pouch';
import { inMemoryPouch } from '../../test/fixtures/pouch';
import { makeVaultFixture } from '../../test/fixtures/vault';
import {
  DOC_TYPES,
  type AppointmentData,
  type CustomerData,
} from '../../db/types';

const HOUR = 60 * 60_000;

vi.mock('../../sync/photos', () => ({
  storePhoto: vi.fn(async () => 'photo-meta:abc'),
}));

describe('ClientDetail', () => {
  let db: VaultDb;
  let vaultId: string;

  beforeEach(async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const fixture = await makeVaultFixture();
    vaultId = fixture.vaultId;
    db = await inMemoryPouch(fixture);
  });

  afterEach(async () => {
    // Unmount components first so watchChanges feeds cancel before the DB closes.
    cleanup();
    await closeVaultDb();
  });

  async function seedCustomer(id: string, firstName: string, lastName: string, notes?: string): Promise<void> {
    const data: CustomerData = { firstName, lastName, createdAt: 0, notes };
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
    allergenIds?: string[];
  }): Promise<void> {
    const data: AppointmentData = {
      customerId: opts.customerId,
      startAt: opts.startAt,
      endAt: opts.endAt,
      serviceLabel: opts.serviceLabel ?? 'Diagnostika',
      status: opts.status ?? 'scheduled',
      allergenIds: opts.allergenIds,
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

  it('renders "Klient nenalezen" for a missing customer id', async () => {
    render(<ClientDetail db={db} vaultId={vaultId} customerId="customer:missing" />);
    await waitFor(() => expect(screen.getByText('Klient nenalezen')).toBeInTheDocument());
  });

  it('renders the customer full name in the chrome', async () => {
    await seedCustomer('customer:1', 'Klára', 'Dvořáková');
    render(<ClientDetail db={db} vaultId={vaultId} customerId="customer:1" />);
    await waitFor(() => expect(screen.getByText('Klára Dvořáková')).toBeInTheDocument());
  });

  it('shows the active-appointment service label and amber allergen badge', async () => {
    await seedCustomer('customer:1', 'Klára', 'Dvořáková');
    const now = Date.now();
    await seedAppointment({
      id: 'appointment:a',
      customerId: 'customer:1',
      startAt: now - 10 * 60_000,
      endAt: now + 50 * 60_000,
      serviceLabel: 'Diagnostika',
      allergenIds: ['amoniak'],
    });

    const { container } = render(
      <ClientDetail db={db} vaultId={vaultId} customerId="customer:1" />,
    );
    // "Diagnostika" appears both in the current-head AND in the services chips —
    // assert specifically against the current-head element.
    await waitFor(() => {
      const head = container.querySelector('.current-main');
      expect(head).toHaveTextContent('Diagnostika');
    });
    expect(screen.getByText(/Amoniak/i)).toBeInTheDocument();
    expect(screen.getByText(/zbývá/i)).toBeInTheDocument();
  });

  it('renders services and products sections with empty + add chip', async () => {
    await seedCustomer('customer:1', 'A', 'B');
    render(<ClientDetail db={db} vaultId={vaultId} customerId="customer:1" />);
    await waitFor(() => expect(screen.getByText('Služby')).toBeInTheDocument());
    expect(screen.getByText('Produkty')).toBeInTheDocument();
    expect(screen.getAllByText('Přidat').length).toBeGreaterThan(0);
  });

  it('renders "Termín neplánován" when no future appointment exists', async () => {
    await seedCustomer('customer:1', 'A', 'B');
    render(<ClientDetail db={db} vaultId={vaultId} customerId="customer:1" />);
    await waitFor(() => expect(screen.getByText(/Termín neplánován/i)).toBeInTheDocument());
  });

  it('renders Czech-formatted next term when a future appointment exists', async () => {
    await seedCustomer('customer:1', 'A', 'B');
    const fut = new Date();
    fut.setDate(fut.getDate() + 14);
    fut.setHours(10, 0, 0, 0);
    await seedAppointment({
      id: 'appointment:fut',
      customerId: 'customer:1',
      startAt: fut.getTime(),
      endAt: fut.getTime() + HOUR,
    });
    render(<ClientDetail db={db} vaultId={vaultId} customerId="customer:1" />);
    // Czech month name should appear (one of: ledna…prosince).
    await waitFor(() => {
      const text = document.body.textContent ?? '';
      expect(text).toMatch(/ledna|února|března|dubna|května|června|července|srpna|září|října|listopadu|prosince/);
    });
  });

  it('renders customer notes in Patrick-Hand prose', async () => {
    await seedCustomer('customer:1', 'A', 'B', 'Citlivá pokožka');
    render(<ClientDetail db={db} vaultId={vaultId} customerId="customer:1" />);
    await waitFor(() => expect(screen.getByText('Citlivá pokožka')).toBeInTheDocument());
  });
});
