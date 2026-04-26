import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { UpdateBanner } from './UpdateBanner';
import { swUpdate$ } from '../lib/sw-update';

// UpdateBanner subscribes to swUpdate$ (a nanostore). The store is updated
// by the inline SW registration script in Layout.astro firing a
// `sw-waiting-change` window event. In tests we set the store directly.

describe('UpdateBanner', () => {
  beforeEach(() => {
    swUpdate$.set({ waiting: false });
    cleanup();
  });

  it('renders nothing when no waiting SW', () => {
    swUpdate$.set({ waiting: false });
    const { container } = render(<UpdateBanner />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('sw-update-banner')).toBeNull();
  });

  it('renders the banner when a waiting SW is present', () => {
    swUpdate$.set({ waiting: true });
    render(<UpdateBanner />);
    expect(screen.getByTestId('sw-update-banner')).toBeInTheDocument();
    expect(screen.getByTestId('sw-update-banner-action')).toBeInTheDocument();
  });

  it('the action button posts SKIP_WAITING on click', async () => {
    swUpdate$.set({ waiting: true });

    const postMessage = vi.fn();
    const waitingMock = { postMessage } as unknown as ServiceWorker;
    const reg = { waiting: waitingMock } as unknown as ServiceWorkerRegistration;
    const getRegistration = vi.fn().mockResolvedValue(reg);
    const addEventListener = vi.fn();

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        ...globalThis.navigator,
        serviceWorker: { getRegistration, addEventListener },
      },
      configurable: true,
    });

    render(<UpdateBanner />);
    fireEvent.click(screen.getByTestId('sw-update-banner-action'));

    // applyUpdate is async; flush microtasks
    await new Promise((r) => setTimeout(r, 0));

    expect(getRegistration).toHaveBeenCalledWith('/app/');
    expect(addEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });
});
