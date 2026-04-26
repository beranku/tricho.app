import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageToggle } from './LanguageToggle';
import { setLocale, __resetLocaleRuntimeForTests } from '../../i18n';
import { MenuSheet } from './MenuSheet';

describe('LanguageToggle', () => {
  beforeEach(() => {
    __resetLocaleRuntimeForTests();
  });
  afterEach(() => {
    __resetLocaleRuntimeForTests();
  });

  it('renders the active locale\'s self-name', () => {
    setLocale('cs');
    render(<LanguageToggle />);
    expect(screen.getByRole('button')).toHaveTextContent('Čeština');
  });

  it('switches the locale on click', async () => {
    setLocale('cs');
    render(<LanguageToggle />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('English');
  });

  it('aria-label names the locale that will be selected next', () => {
    setLocale('en');
    render(<LanguageToggle />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toMatch(/Čeština/);
  });
});

describe('MenuSheet locale propagation', () => {
  beforeEach(() => {
    __resetLocaleRuntimeForTests();
  });
  afterEach(() => {
    __resetLocaleRuntimeForTests();
  });

  it('switching locale re-renders every menu row in the new language', async () => {
    setLocale('cs');
    render(<MenuSheet />);
    expect(screen.getByText('Klienti')).toBeInTheDocument();
    expect(screen.getByText('Nastavení')).toBeInTheDocument();

    await act(async () => {
      setLocale('en');
    });

    expect(screen.getByText('Clients')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.queryByText('Klienti')).toBeNull();
  });
});
