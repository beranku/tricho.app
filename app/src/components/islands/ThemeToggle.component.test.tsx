import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './ThemeToggle';
import { themeStore } from '../../lib/store/theme';

vi.mock('../../lib/store/theme', async (orig) => {
  const real = await orig<typeof import('../../lib/store/theme')>();
  return {
    ...real,
    bootstrapTheme: vi.fn().mockResolvedValue(undefined),
    setTheme: vi.fn(async (t: 'light' | 'dark') => {
      real.themeStore.set(t);
      if (t === 'dark') document.documentElement.dataset.theme = 'dark';
      else delete document.documentElement.dataset.theme;
    }),
    toggleTheme: vi.fn(async () => {
      const next = real.themeStore.get() === 'dark' ? 'light' : 'dark';
      real.themeStore.set(next);
      if (next === 'dark') document.documentElement.dataset.theme = 'dark';
      else delete document.documentElement.dataset.theme;
    }),
  };
});

import { toggleTheme } from '../../lib/store/theme';

describe('ThemeToggle', () => {
  beforeEach(() => {
    act(() => themeStore.set('light'));
    delete document.documentElement.dataset.theme;
  });

  it('renders a button labelled Světlý in light mode', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveTextContent(/Světlý/);
  });

  it('renders a button labelled Tmavý in dark mode', () => {
    act(() => themeStore.set('dark'));
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveTextContent(/Tmavý/);
  });

  it('clicking calls toggleTheme', async () => {
    render(<ThemeToggle />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button'));
    expect(toggleTheme).toHaveBeenCalled();
  });

  it('after toggle, html has data-theme=dark', async () => {
    render(<ThemeToggle />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
