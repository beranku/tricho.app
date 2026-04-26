import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BottomSheet } from './BottomSheet';
import { openSheet, closeSheet, sheetStore } from '../../lib/store/sheet';

describe('BottomSheet', () => {
  beforeEach(() => {
    act(() => closeSheet());
  });

  it('renders backdrop + sheet but both are hidden when closed', () => {
    const { container } = render(<BottomSheet renderers={{ menu: () => <div>Menu</div> }} />);
    expect(container.querySelector('.sheet-backdrop')).not.toHaveClass('open');
    expect(container.querySelector('.sheet')).not.toHaveClass('open');
  });

  it('opens with the specified renderer', () => {
    const { container } = render(<BottomSheet renderers={{ menu: () => <div>Klienti</div> }} />);
    act(() => openSheet('menu'));
    expect(container.querySelector('.sheet')).toHaveClass('open');
    expect(container.querySelector('.sheet-backdrop')).toHaveClass('open');
    expect(screen.getByText('Klienti')).toBeInTheDocument();
  });

  it('clicking the backdrop closes the sheet', async () => {
    const { container } = render(
      <BottomSheet renderers={{ menu: () => <button>row</button> }} />,
    );
    act(() => openSheet('menu'));
    const user = userEvent.setup();
    await user.click(container.querySelector('.sheet-backdrop')!);
    expect(sheetStore.get().open).toBe(false);
  });

  it('Escape key closes the sheet', async () => {
    render(<BottomSheet renderers={{ menu: () => <button>row</button> }} />);
    act(() => openSheet('menu'));
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(sheetStore.get().open).toBe(false);
  });

  it('Escape listener is removed after close', async () => {
    render(<BottomSheet renderers={{ menu: () => <button>row</button> }} />);
    act(() => openSheet('menu'));
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    // After close, pressing Escape again must not throw or reopen.
    await user.keyboard('{Escape}');
    expect(sheetStore.get().open).toBe(false);
  });

  it('renders nothing inside the sheet when no renderer matches', () => {
    const { container } = render(<BottomSheet renderers={{ menu: () => <div>Menu</div> }} />);
    act(() => openSheet('fab-add'));
    // No matching renderer for fab-add → only the handle remains.
    const sheet = container.querySelector('.sheet');
    expect(sheet?.querySelectorAll('.sheet-handle').length).toBe(1);
    expect(sheet?.textContent?.replace(/\s+/g, '')).toBe('');
  });
});
