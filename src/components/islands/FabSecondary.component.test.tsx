import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { FabSecondary } from './FabSecondary';
import { phoneScrollStore } from '../../lib/store/phoneScroll';

describe('FabSecondary', () => {
  beforeEach(() => {
    act(() => phoneScrollStore.set({ stuckDay: null, todayInView: true, todayDirection: null }));
  });

  it('is hidden when today is in view', () => {
    render(<FabSecondary />);
    expect(screen.getByRole('button', { name: /Zpět na dnešek/i })).not.toHaveClass('visible');
  });

  it('becomes visible with up direction when today is below', () => {
    act(() =>
      phoneScrollStore.set({ stuckDay: 'past', todayInView: false, todayDirection: 'down' }),
    );
    render(<FabSecondary />);
    const btn = screen.getByRole('button', { name: /Zpět na dnešek/i });
    expect(btn).toHaveClass('visible');
    expect(btn).toHaveClass('direction-down');
  });

  it('becomes visible with down direction when today is above', () => {
    act(() =>
      phoneScrollStore.set({ stuckDay: 'future', todayInView: false, todayDirection: 'up' }),
    );
    render(<FabSecondary />);
    const btn = screen.getByRole('button', { name: /Zpět na dnešek/i });
    expect(btn).toHaveClass('visible');
    expect(btn).toHaveClass('direction-up');
  });
});
