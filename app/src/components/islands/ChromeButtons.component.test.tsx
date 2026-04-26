import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChromeButtons } from './ChromeButtons';
import { sheetStore, closeSheet } from '../../lib/store/sheet';

describe('ChromeButtons', () => {
  beforeEach(() => {
    act(() => closeSheet());
  });

  it('variant a renders menu + ellipsis buttons', () => {
    render(<ChromeButtons variant="a" />);
    expect(screen.getByRole('button', { name: /Otevřít menu/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Další možnosti/i })).toBeInTheDocument();
  });

  it('variant b renders back link instead of menu', () => {
    render(<ChromeButtons variant="b" backHref="#/" />);
    expect(screen.getByRole('link', { name: /Zpět/i })).toHaveAttribute('href', '#/');
  });

  it('clicking menu opens the menu sheet', async () => {
    render(<ChromeButtons variant="a" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Otevřít menu/i }));
    expect(sheetStore.get().open).toBe(true);
    expect(sheetStore.get().type).toBe('menu');
  });

  it('clicking ellipsis opens the context sheet', async () => {
    render(<ChromeButtons variant="a" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Další možnosti/i }));
    expect(sheetStore.get().open).toBe(true);
    expect(sheetStore.get().type).toBe('context');
  });
});
