/**
 * Daily-schedule view (Phone A). Fetches a 7-day window of appointments,
 * groups by day, renders today + 1 past day + 5 future days. Each day's
 * slots are a mix of real appointments + synthesised free-slots.
 *
 * Customer names are looked up at render time (cheap; few customers per day).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import type { VaultDb } from '../../db/pouch';
import { getDecrypted, watchChanges, DOC_TYPES } from '../../db/pouch';
import {
  queryAppointments,
  synthesizeSlots,
  currentStatus,
  type AppointmentRecord,
  type ScheduleSlot,
} from '../../lib/appointment';
import type { CustomerData } from '../../db/types';
import { formatDate, formatTime, formatDuration, formatWeekdayKicker } from '../../lib/format';
import { openSheet } from '../../lib/store/sheet';
import { localeStore, m } from '../../i18n';
import { PhoneScroll } from './PhoneScroll';
import { FabSecondary } from './FabSecondary';

const DAY_MS = 86_400_000;

export interface DailyScheduleProps {
  db: VaultDb;
}

interface DayBucket {
  day: string;       // YYYY-MM-DD
  date: Date;        // start of day
  slots: ScheduleSlot[];
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

export function DailySchedule({ db }: DailyScheduleProps): JSX.Element {
  // Re-render on locale change so every `m.<key>()` and dispatched format
  // helper picks up the new locale within the next paint.
  useStore(localeStore);
  const today = useMemo(() => startOfDay(new Date()), []);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [customerNames, setCustomerNames] = useState<Map<string, string>>(new Map());
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const start = today.getTime() - DAY_MS;
      const end = today.getTime() + 6 * DAY_MS;
      const window = await queryAppointments(db, { start, end });
      setAppointments(window);

      const ids = new Set(window.map((a) => a.customerId));
      const next = new Map<string, string>();
      for (const id of ids) {
        const doc = await getDecrypted<CustomerData>(db, id).catch(() => null);
        if (!doc) continue;
        next.set(id, `${doc.data.firstName} ${doc.data.lastName}`);
      }
      setCustomerNames(next);
      setLoaded(true);
    } catch (err) {
      // Closing the DB mid-refresh (e.g. on unmount during a test) throws
      // "database is closed" — silence that path; surface anything else.
      if (!String(err).includes('database is closed')) console.warn('[DailySchedule] refresh', err);
    }
  }, [db, today]);

  useEffect(() => {
    void refresh();
    const h = watchChanges(db, ({ type }) => {
      if (type === DOC_TYPES.APPOINTMENT || type === DOC_TYPES.CUSTOMER) void refresh();
    });
    return () => h.cancel();
  }, [db, refresh]);

  const days: DayBucket[] = useMemo(() => {
    const out: DayBucket[] = [];
    for (let i = -1; i <= 5; i++) {
      const d = new Date(today.getTime() + i * DAY_MS);
      const dayStart = d.getTime();
      const dayEnd = endOfDay(d).getTime();
      const dayAppts = appointments.filter((a) => a.startAt >= dayStart && a.startAt < dayEnd);
      // Default business hours: 8:00–18:00.
      const hours = {
        start: dayStart + 8 * 60 * 60_000,
        end: dayStart + 18 * 60 * 60_000,
      };
      const slots = synthesizeSlots(dayAppts, hours);
      out.push({ day: ymd(d), date: d, slots });
    }
    return out;
  }, [appointments, today]);

  return (
    <PhoneScroll>
      {days.map(({ day, date, slots }) => {
        const isToday = ymd(date) === ymd(today);
        const isPast = date.getTime() < today.getTime();
        const isFuture = date.getTime() > today.getTime();
        const delta = Math.round((date.getTime() - today.getTime()) / DAY_MS);
        const kicker = (() => {
          if (delta === 1) return m.schedule_tomorrow();
          if (delta === -1) return m.schedule_yesterday();
          return formatWeekdayKicker(date);
        })();
        const dateLabel = formatDate(date, today);

        return (
          <section key={day} className="day-section" data-day={day} data-today={isToday ? 'true' : undefined}>
            {isToday ? (
              <DayHeaderTodayInline date={dateLabel} />
            ) : (
              <DayDividerInline kicker={kicker} date={dateLabel} />
            )}
            {slots.map((slot, idx) => {
              if (slot.kind === 'free') {
                if (isPast) return null;
                return (
                  <FreeSlotInline
                    key={`free-${day}-${idx}`}
                    time={formatTime(new Date(slot.startAt))}
                    durationLabel={m.schedule_freeSlot({
                      duration: formatDuration(slot.endAt - slot.startAt),
                    })}
                    startAt={slot.startAt}
                  />
                );
              }
              const a = slot.appointment;
              const status = currentStatus(a, Date.now());
              const name = customerNames.get(a.customerId) ?? m.schedule_clientFallback();
              const time = formatTime(new Date(a.startAt));
              if (status === 'done' || (isPast && status !== 'active')) {
                return <DoneSlotInline key={a.id} appointmentId={a.customerId} time={time} name={name} sub={a.serviceLabel} />;
              }
              if (status === 'active') {
                return <ActiveSlotInline key={a.id} appointmentId={a.customerId} time={time} name={name} sub={a.serviceLabel} />;
              }
              return <ScheduledSlotInline key={a.id} appointmentId={a.customerId} time={time} name={name} sub={a.serviceLabel} />;
            })}
          </section>
        );
      })}
      {loaded && appointments.length === 0 && <EmptyDay />}
      <FabPrimary />
      <FabSecondary />
    </PhoneScroll>
  );
}

// Inline render helpers — keep static markup in one tree so we can declare it
// React-side without losing the design-system styling.

function DayHeaderTodayInline({ date }: { date: string }): JSX.Element {
  return (
    <div className="day-header-today">
      <span className="weather-sun-left" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 8.5 9 Q 7.8 12.2 9.8 14.4 Q 12 15.8 14.3 14.4 Q 16 12 14.6 9.5 Q 12.5 8 10 8.4 Q 8.9 8.7 8.5 9 Z" />
          <path d="M 12 3 L 12 5.2" />
          <path d="M 12 18.8 L 12 21" />
          <path d="M 3 12 L 5.2 12" />
          <path d="M 18.8 12 L 21 12" />
          <path d="M 5.4 5.4 L 7 7" />
          <path d="M 17 17 L 18.6 18.6" />
          <path d="M 5.4 18.6 L 7 17" />
          <path d="M 17 7 L 18.6 5.4" />
        </svg>
      </span>
      <button type="button" className="chrome-title" aria-label={m.schedule_today()}>
        <div className="chrome-stack">
          <span className="kicker live">{m.schedule_today()}</span>
          <span className="chrome-main font-fraunces tabular-nums">{date}</span>
        </div>
      </button>
      <style>{dayHeaderStyles}</style>
    </div>
  );
}

function DayDividerInline({ kicker, date }: { kicker: string; date: string }): JSX.Element {
  return (
    <div className="dv-a-wrap">
      <div className="dv-a">
        <span className="dv-a-line" />
        <span className="kicker">{kicker}</span>
        <span className="dv-a-line" />
      </div>
      <div className="dv-a-main font-fraunces tabular-nums">{date}</div>
      <style>{dvAStyles}</style>
    </div>
  );
}

function ScheduledSlotInline({ appointmentId, time, name, sub }: { appointmentId: string; time: string; name: string; sub: string }): JSX.Element {
  return (
    <a className="slot" href={`#/clients/${encodeURIComponent(appointmentId)}`}>
      <span className="slot-time font-fraunces tabular-nums">{time}</span>
      <span className="slot-body">
        <span className="slot-name font-fraunces">{name}</span>
        <span className="slot-sub font-geist">{sub}</span>
      </span>
      <span className="slot-spacer" />
      <style>{slotStyles}</style>
    </a>
  );
}

function ActiveSlotInline({ appointmentId, time, name, sub }: { appointmentId: string; time: string; name: string; sub: string }): JSX.Element {
  return (
    <a className="slot slot-active" href={`#/clients/${encodeURIComponent(appointmentId)}`}>
      <span className="slot-time font-fraunces tabular-nums">{time}</span>
      <span className="slot-body">
        <span className="slot-name font-fraunces">{name}</span>
        <span className="slot-sub font-geist">{sub}</span>
      </span>
      <span className="slot-spacer" />
      <style>{slotStyles}</style>
    </a>
  );
}

function DoneSlotInline({ appointmentId, time, name, sub }: { appointmentId: string; time: string; name: string; sub: string }): JSX.Element {
  return (
    <a className="slot slot-done" href={`#/clients/${encodeURIComponent(appointmentId)}`}>
      <span className="slot-time font-fraunces tabular-nums">{time}</span>
      <span className="slot-body">
        <span className="slot-name font-fraunces">{name}</span>
        <span className="slot-sub font-geist">{sub}</span>
      </span>
      <span className="slot-done-check" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2.8 7.2 C 3.8 8.6, 4.8 9.6, 5.7 10.2 C 6.5 8.3, 8.7 5.4, 11.4 2.8" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <style>{slotStyles}</style>
    </a>
  );
}

function FreeSlotInline({ time, durationLabel, startAt }: { time: string; durationLabel: string; startAt: number }): JSX.Element {
  return (
    <button
      type="button"
      className="slot slot-free-row"
      onClick={() => openSheet('fab-add', { payload: { startAt } })}
    >
      <span className="slot-time slot-time--dim font-fraunces tabular-nums">{time}</span>
      <span className="slot-body">
        <span className="slot-free font-patrick">{durationLabel}</span>
      </span>
      <span className="slot-plus font-caveat" aria-hidden="true">+</span>
      <style>{slotStyles}</style>
    </button>
  );
}

function FabPrimary(): JSX.Element {
  return (
    <button
      type="button"
      className="fab"
      aria-label={m.schedule_addAppointment()}
      onClick={() => openSheet('fab-add')}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2.5" />
        <path d="M3 9 H21" />
        <path d="M8 3 V7" />
        <path d="M16 3 V7" />
        <path d="M12 12 V18" />
        <path d="M9 15 H15" />
      </svg>
      <style>{`
        .fab {
          position: absolute;
          bottom: calc(24px + env(safe-area-inset-bottom, 0px));
          right: 18px;
          width: 58px;
          height: 58px;
          border-radius: 19px;
          background: linear-gradient(160deg, var(--teal) 0%, var(--teal) 50%, var(--teal-strong) 100%);
          color: var(--bg);
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow:
            0 1px 2px rgba(14, 116, 144, 0.15),
            0 6px 14px -2px rgba(14, 116, 144, 0.22),
            0 18px 32px -10px rgba(176, 110, 82, 0.22),
            inset 0 1px 0 rgba(255,255,255,0.14),
            inset 0 -1px 0 rgba(0,0,0,0.1);
          z-index: var(--z-fab);
          cursor: pointer;
        }
      `}</style>
    </button>
  );
}

function EmptyDay(): JSX.Element {
  return (
    <div className="empty-day font-patrick">
      <p>{m.menu_promo_body()}</p>
      <style>{`
        .empty-day {
          margin: 32px 24px;
          padding: 20px;
          font-size: 17px;
          color: var(--ink-3);
          text-align: center;
          line-height: 1.5;
        }
        .empty-plus { color: var(--copper); font-weight: 600; }
      `}</style>
    </div>
  );
}

const dayHeaderStyles = `
  .day-header-today {
    position: sticky;
    top: 46px;
    min-height: 48px;
    padding: 6px 68px 10px;
    background: var(--bg);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: var(--z-top-chrome);
  }
  .weather-sun-left {
    position: absolute;
    left: 64px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--copper);
    opacity: 0.9;
    pointer-events: none;
    display: inline-flex;
    align-items: center;
  }
  .chrome-title {
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .chrome-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    line-height: 1;
  }
  .chrome-main {
    font-weight: 500;
    font-variation-settings: 'opsz' 28;
    font-size: 20px;
    color: var(--ink);
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
`;

const dvAStyles = `
  .dv-a-wrap {
    position: sticky;
    top: 46px;
    padding: 10px 20px 12px;
    background: var(--bg);
    z-index: var(--z-dv-a);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    min-height: 48px;
  }
  .dv-a {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--copper);
  }
  .dv-a-line {
    flex: 0 0 32px;
    height: 1px;
    background: var(--copper-border);
    opacity: 0.6;
  }
  .dv-a-main {
    font-weight: 500;
    font-variation-settings: 'opsz' 28;
    font-size: 20px;
    color: var(--ink);
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
`;

const slotStyles = `
  .slot {
    display: grid;
    grid-template-columns: 62px 1fr auto;
    align-items: start;
    padding: 14px 20px;
    gap: 16px;
    min-height: 64px;
    color: inherit;
    text-decoration: none;
    background: transparent;
    border: none;
    text-align: left;
    width: 100%;
    cursor: pointer;
  }
  .slot-time {
    font-weight: 600;
    font-variation-settings: 'opsz' 18;
    font-size: 19px;
    color: var(--ink-2);
    line-height: 1.1;
    padding-top: 1px;
  }
  .slot-time--dim { color: var(--ink-4); font-weight: 550; }
  .slot-body { display: flex; flex-direction: column; min-width: 0; }
  .slot-name {
    font-weight: 500;
    font-variation-settings: 'opsz' 36;
    font-size: 19px;
    color: var(--ink);
    line-height: 1.1;
  }
  .slot-sub {
    font-size: 13px;
    color: var(--ink-3);
    margin-top: 5px;
  }
  .slot-spacer { width: 22px; }
  .slot-active {
    background: var(--teal-tint);
    border: 1px solid var(--teal-border);
    border-radius: var(--radius-card);
    padding: 14px 16px;
    margin: 4px 4px;
    box-shadow: 0 1px 2px rgba(14, 116, 144, 0.04);
  }
  .slot-active .slot-time { color: var(--teal-strong); }
  .slot-active .slot-name { color: var(--teal-strong); font-weight: 550; }
  .slot-done { opacity: 0.55; }
  .slot-done .slot-time { color: var(--ink-4); font-weight: 550; }
  .slot-done .slot-name { color: var(--ink-3); font-weight: 500; }
  .slot-done .slot-sub { color: var(--ink-4); }
  .slot-done-check {
    color: var(--copper-mid);
    width: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-top: 4px;
    opacity: 0.85;
  }
  .slot-free {
    font-weight: 400;
    font-size: 18px;
    color: var(--ink-3);
    line-height: 1.1;
    padding-top: 1px;
  }
  .slot-plus {
    color: var(--copper);
    font-size: 26px;
    font-weight: 600;
    width: 22px;
    text-align: center;
    line-height: 1;
    padding-top: 1px;
  }
`;
