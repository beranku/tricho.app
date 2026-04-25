/**
 * Client-detail view (Phone B). Loads a single customer + their appointments
 * + photos. Renders current-head, cam-card, thumbnail strip, detail card.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import type { VaultDb } from '../../db/pouch';
import { getDecrypted, watchChanges, DOC_TYPES, queryDecrypted } from '../../db/pouch';
import {
  queryAppointmentsForCustomer,
  currentStatus,
  type AppointmentRecord,
} from '../../lib/appointment';
import type { CustomerData, PhotoMetaData, PlaintextDoc } from '../../db/types';
import { formatDate, formatDuration } from '../../lib/format';
import { localeStore, m } from '../../i18n';
import { CameraCard } from './CameraCard';
import { PhoneScroll } from './PhoneScroll';

export interface ClientDetailProps {
  db: VaultDb;
  vaultId: string;
  customerId: string;
}

export function ClientDetail({ db, vaultId, customerId }: ClientDetailProps): JSX.Element {
  useStore(localeStore);
  const [customer, setCustomer] = useState<CustomerData | null | undefined>(undefined);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [photos, setPhotos] = useState<PlaintextDoc<PhotoMetaData>[]>([]);

  const refresh = useCallback(async () => {
    try {
      const c = await getDecrypted<CustomerData>(db, customerId).catch(() => null);
      setCustomer(c?.data ?? null);

      const appts = await queryAppointmentsForCustomer(db, customerId);
      setAppointments(appts);

      const allPhotos = await queryDecrypted<PhotoMetaData>(db, DOC_TYPES.PHOTO_META);
      setPhotos(allPhotos.filter((p) => p.data.customerId === customerId));
    } catch (err) {
      if (!String(err).includes('database is closed')) console.warn('[ClientDetail] refresh', err);
    }
  }, [db, customerId]);

  useEffect(() => {
    void refresh();
    const h = watchChanges(db, ({ type }) => {
      if (
        type === DOC_TYPES.CUSTOMER ||
        type === DOC_TYPES.APPOINTMENT ||
        type === DOC_TYPES.PHOTO_META
      ) {
        void refresh();
      }
    });
    return () => h.cancel();
  }, [db, refresh]);

  const now = Date.now();
  const active = useMemo(
    () => appointments.find((a) => currentStatus(a, now) === 'active'),
    [appointments, now],
  );
  const nextScheduled = useMemo(
    () =>
      appointments
        .filter((a) => a.startAt > now && a.status !== 'done')
        .sort((a, b) => a.startAt - b.startAt)[0],
    [appointments, now],
  );

  if (customer === undefined) {
    return (
      <PhoneScroll>
        <p className="loading">{m.appShell_loading()}</p>
        <style>{`.loading { padding: 32px 24px; color: var(--ink-3); font-family: 'Geist', sans-serif; }`}</style>
      </PhoneScroll>
    );
  }

  if (customer === null) {
    return (
      <PhoneScroll>
        <div className="not-found">
          <p className="font-fraunces">{m.client_notFound()}</p>
        </div>
        <style>{`
          .not-found {
            padding: 80px 24px;
            text-align: center;
            color: var(--ink-3);
          }
          .not-found p {
            font-size: 22px;
            font-weight: 550;
          }
        `}</style>
      </PhoneScroll>
    );
  }

  const fullName = `${customer.firstName} ${customer.lastName}`;
  const allergenLabel = active?.allergenIds?.[0]
    ? capitalize(active.allergenIds[0]!)
    : undefined;
  const remainingLabel =
    active && active.endAt > now
      ? m.client_remainingMinutes({ minutes: formatDuration(active.endAt - now) })
      : undefined;

  return (
    <PhoneScroll>
      <ClientChromeHeader name={fullName} />

      {active && (
        <CurrentHeadInline
          serviceLabel={active.serviceLabel}
          allergen={allergenLabel}
          remainingLabel={remainingLabel}
        />
      )}

      <CameraCard db={db} vaultId={vaultId} customerId={customerId} appointmentId={active?.id} />

      <ThumbnailStrip photos={photos} />

      <div className="detail-card">
        <ServicesSection appointments={appointments} />
        <ProductsSection appointments={appointments} />
        <NoteSection notes={customer.notes} />
        <NextTermSection nextScheduled={nextScheduled} now={now} />
      </div>

      <style>{detailStyles}</style>
    </PhoneScroll>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ClientChromeHeader({ name }: { name: string }): JSX.Element {
  return (
    <div className="client-chrome">
      <span className="kicker">{m.client_kicker()}</span>
      <span className="chrome-main client-name font-fraunces">{name}</span>
      <style>{`
        .client-chrome {
          position: sticky;
          top: 46px;
          padding: 8px 68px 10px;
          background: var(--bg);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          z-index: var(--z-top-chrome);
        }
        .client-name {
          font-weight: 500;
          font-variation-settings: 'opsz' 36;
          font-size: 20px;
          color: var(--ink);
          letter-spacing: -0.02em;
          line-height: 1.1;
        }
      `}</style>
    </div>
  );
}

function CurrentHeadInline({
  serviceLabel,
  allergen,
  remainingLabel,
}: {
  serviceLabel: string;
  allergen?: string;
  remainingLabel?: string;
}): JSX.Element {
  return (
    <div className="current-head">
      <div className="current-main font-fraunces tabular-nums">{serviceLabel}</div>
      <div className="alert-meta">
        {allergen && <span className="alert-allergen font-caveat">{allergen}</span>}
        {remainingLabel && (
          <span className="alert-remaining font-geist tabular-nums">{remainingLabel}</span>
        )}
      </div>
    </div>
  );
}

function ThumbnailStrip({ photos }: { photos: PlaintextDoc<PhotoMetaData>[] }): JSX.Element {
  if (photos.length === 0) {
    return (
      <div className="thumbs-empty font-patrick">
        {m.client_noPhotos()}
        <style>{`
          .thumbs-empty {
            padding: 0 16px 18px;
            color: var(--ink-3);
            font-size: 15px;
            text-align: center;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="thumbs">
      {photos
        .sort((a, b) => b.data.takenAt - a.data.takenAt)
        .slice(0, 3)
        .map((p) => {
          const angle = p.data.angle ?? 'detail';
          const label = p.data.label ?? capitalize(angle);
          return (
            <div key={p._id} className={`thumb thumb-${angle}`}>
              <span className="thumb-label font-patrick">{label}</span>
            </div>
          );
        })}
      <style>{`
        .thumbs {
          padding: 0 12px;
          display: flex;
          gap: 10px;
          margin-bottom: 24px;
        }
        .thumb {
          width: 76px;
          height: 76px;
          border-radius: 13px;
          display: flex;
          align-items: flex-end;
          padding: 6px 8px;
          position: relative;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(69, 48, 28, 0.1);
        }
        .thumb-before { background: linear-gradient(135deg, #A56B42, #7A4A2C 60%, #57341D); }
        .thumb-detail { background: linear-gradient(135deg, #4A5B72, #34425A 60%, #1F2A3E); }
        .thumb-after { background: linear-gradient(135deg, #3F4E68, #2B3850 60%, #1A2438); }
        .thumb-label {
          font-size: 14px;
          color: var(--ink-espresso);
          background: rgba(253, 250, 243, 0.94);
          padding: 2px 9px 3px;
          border-radius: 6px;
          line-height: 1.15;
        }
      `}</style>
    </div>
  );
}

function ServicesSection({ appointments }: { appointments: AppointmentRecord[] }): JSX.Element {
  const services = Array.from(
    new Set(appointments.map((a) => a.serviceLabel).filter(Boolean)),
  );
  return (
    <div className="detail-section">
      <div className="section-head-row">
        <span className="section-label">{m.client_section_services()}</span>
      </div>
      <div className="chips-row">
        {services.map((s) => (
          <span key={s} className="chip font-geist">
            {s}
          </span>
        ))}
        <button type="button" className="chip chip--add font-geist">
          <span className="chip-add-plus" aria-hidden="true">+</span>
          <span>{m.client_add()}</span>
        </button>
      </div>
    </div>
  );
}

function ProductsSection({ appointments }: { appointments: AppointmentRecord[] }): JSX.Element {
  const products = Array.from(
    new Set(appointments.flatMap((a) => a.productIds ?? [])),
  );
  return (
    <div className="detail-section">
      <div className="section-head-row">
        <span className="section-label">{m.client_section_products()}</span>
      </div>
      <div className="chips-row">
        {products.map((p) => (
          <span key={p} className="chip font-geist">
            {p}
          </span>
        ))}
        <button type="button" className="chip chip--add font-geist">
          <span className="chip-add-plus" aria-hidden="true">+</span>
          <span>{m.client_add()}</span>
        </button>
      </div>
    </div>
  );
}

function NoteSection({ notes }: { notes?: string }): JSX.Element {
  return (
    <div className="detail-section">
      <div className="section-head-row">
        <span className="section-label">{m.client_section_note()}</span>
      </div>
      {notes ? (
        <p className="note-text font-patrick">{notes}</p>
      ) : (
        <p className="note-text font-patrick" style={{ color: 'var(--ink-4)' }}>
          {m.client_noNote()}
        </p>
      )}
    </div>
  );
}

function NextTermSection({
  nextScheduled,
  now,
}: {
  nextScheduled?: AppointmentRecord;
  now: number;
}): JSX.Element {
  return (
    <div className="next-term">
      <span className="section-label next-term-label">{m.client_section_nextTerm()}</span>
      <span className="next-term-value font-patrick">
        {nextScheduled ? formatDate(nextScheduled.startAt, now) : m.client_noNextTerm()}
      </span>
    </div>
  );
}

const detailStyles = `
  .current-head {
    padding: 0 20px;
    margin-top: 4px;
    margin-bottom: 12px;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  .current-main {
    font-weight: 550;
    font-variation-settings: 'opsz' 28;
    font-size: 22px;
    color: var(--teal-strong);
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .alert-meta {
    display: inline-flex;
    align-items: baseline;
    gap: 11px;
    white-space: nowrap;
  }
  .alert-allergen {
    font-weight: 600;
    font-size: 22px;
    color: var(--amber);
    line-height: 1;
  }
  .alert-remaining {
    font-size: 13px;
    font-weight: 500;
    color: var(--ink-3);
    line-height: 1;
  }
  .detail-card {
    margin: 0 12px 20px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-panel);
    padding: 20px 20px 4px;
    box-shadow: var(--card-shadow);
    position: relative;
    z-index: 2;
  }
  .detail-section {
    padding: 16px 0;
    border-bottom: 1px solid var(--line-soft);
  }
  .detail-section:last-child { border-bottom: none; }
  .detail-section:first-child { padding-top: 2px; }
  .section-head-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 14px;
  }
  .section-label {
    font-family: 'Geist', sans-serif;
    font-size: 11px;
    font-weight: 550;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--ink-3);
  }
  .chips-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 8px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px 8px 10px;
    border-radius: 999px;
    font-size: 14.5px;
    font-weight: 400;
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink);
    text-decoration: none;
    cursor: default;
  }
  .chip--add {
    border: 1px dashed var(--copper-border);
    background: transparent;
    color: var(--copper-mid);
    cursor: pointer;
  }
  .chip-add-plus {
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--copper-mid);
    font-size: 16px;
  }
  .note-text {
    font-weight: 400;
    font-size: 18px;
    color: var(--ink-2);
    line-height: 1.4;
  }
  .next-term {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px 24px;
    margin: 0 12px 20px;
  }
  .next-term-value {
    font-weight: 400;
    font-size: 18px;
    color: var(--ink-3);
    display: flex;
    align-items: center;
    gap: 10px;
    line-height: 1;
  }
`;
