import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MenuSheet, FabAddSheet } from './MenuSheet';

vi.mock('../../sync/couch', () => ({
  subscribeSyncEvents: vi.fn(() => () => {}),
}));
vi.mock('../../lib/store/theme', async (orig) => {
  const real = await orig<typeof import('../../lib/store/theme')>();
  return {
    ...real,
    bootstrapTheme: vi.fn().mockResolvedValue(undefined),
    toggleTheme: vi.fn().mockResolvedValue(undefined),
  };
});

describe('MenuSheet', () => {
  it('renders the required navigation rows including language + theme', () => {
    render(<MenuSheet />);
    // After the i18n migration, labels come from `m.<key>()` and the
    // component-test setup pins locale to `cs`, so Czech strings are
    // the expected output.
    expect(screen.getByText('Klienti')).toBeInTheDocument();
    expect(screen.getByText('Statistika')).toBeInTheDocument();
    expect(screen.getByText('Archiv')).toBeInTheDocument();
    expect(screen.getByText('Nastavení')).toBeInTheDocument();
    expect(screen.getByText('Jazyk')).toBeInTheDocument();
    expect(screen.getByText('Motiv')).toBeInTheDocument();
    expect(screen.getByText('Odhlásit')).toBeInTheDocument();
  });

  it('deferred rows show "Připravujeme"', () => {
    render(<MenuSheet />);
    const klienti = screen.getByText('Klienti').closest('.sheet-item') as HTMLElement;
    expect(klienti).toHaveTextContent('Připravujeme');
  });

  it('clicking Nastavení invokes the onSettings callback', async () => {
    const onSettings = vi.fn();
    render(<MenuSheet onSettings={onSettings} />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Nastavení'));
    expect(onSettings).toHaveBeenCalled();
  });

  it('clicking Odhlásit invokes the onLogout callback', async () => {
    const onLogout = vi.fn();
    render(<MenuSheet onLogout={onLogout} />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Odhlásit'));
    expect(onLogout).toHaveBeenCalled();
  });
});

describe('FabAddSheet', () => {
  // The visit-creation flow is deferred (per `daily-schedule` SHALL).
  // This sheet is the placeholder; copy is locked verbatim to the spec
  // so that commit ff9e306-style regressions (pointing the body at
  // `m.menu_promo_body()`) fail fast at the component tier.
  it('shows the spec-aligned deferred-feature title', () => {
    render(<FabAddSheet />);
    expect(screen.getByText('Plánování v příští verzi')).toBeInTheDocument();
  });

  it('shows the spec-aligned deferred-feature body', () => {
    render(<FabAddSheet />);
    expect(
      screen.getByText(/Přidávání a úpravy zákroků dorazí v další verzi/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Zatím můžeš prohlížet diár a otevírat karty klientek\.$/),
    ).toBeInTheDocument();
  });

  it('does not surface the unrelated menu_promo_body string', () => {
    render(<FabAddSheet />);
    expect(
      screen.queryByText('Otevřete plán a prohlížejte detaily klientů.'),
    ).not.toBeInTheDocument();
  });

  it('shows the start time when payload provides startAt', () => {
    const startAt = new Date(2026, 3, 25, 11, 0).getTime();
    render(<FabAddSheet payload={{ startAt }} />);
    expect(screen.getByText(/11:00/)).toBeInTheDocument();
  });
});
