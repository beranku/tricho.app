import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CameraCard } from './CameraCard';
import type { VaultDb } from '../../db/pouch';

vi.mock('../../sync/photos', () => ({
  storePhoto: vi.fn(async () => 'photo-meta:abc'),
}));
vi.mock('../../crypto/envelope', () => ({
  envelopeEncrypt: vi.fn(async () => ({ ct: 'AAAA', iv: 'BBBB' })),
  encodeBase64url: vi.fn(() => 'YWFh'),
  decodeBase64url: vi.fn(() => new Uint8Array([1, 2, 3])),
}));

import { storePhoto } from '../../sync/photos';

const fakeDb: VaultDb = {
  pouch: {} as VaultDb['pouch'],
  vaultId: 'vault-1',
  dek: {} as CryptoKey,
  dbName: 'tricho_test',
};

describe('CameraCard', () => {
  beforeEach(() => {
    // Reset getUserMedia to a granted-stream mock.
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
      getVideoTracks: () => [{ stop: vi.fn() }],
      getAudioTracks: () => [],
    });
  });

  it('renders the capture button when permission is granted', async () => {
    render(<CameraCard db={fakeDb} vaultId="vault-1" customerId="customer:1" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Pořídit fotografii/i })).toBeInTheDocument(),
    );
  });

  it('shows the permission-denied message when getUserMedia rejects', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('NotAllowedError'),
    );
    render(<CameraCard db={fakeDb} vaultId="vault-1" customerId="customer:1" />);
    await waitFor(() =>
      expect(screen.getByText(/povolit přístup ke kameře/i)).toBeInTheDocument(),
    );
  });

  it('label dropdown changes the active angle', async () => {
    const { container } = render(
      <CameraCard db={fakeDb} vaultId="vault-1" customerId="customer:1" />,
    );
    const user = userEvent.setup();
    // The chip button has class .cam-label-chip — exactly one in the DOM.
    const chip = await waitFor(() => container.querySelector<HTMLElement>('.cam-label-chip')!);
    await user.click(chip);
    // The menu options have role menuitemradio — disambiguates from the chip button.
    const po = await screen.findByRole('menuitemradio', { name: /Po/i });
    await user.click(po);
    expect(container.querySelector('.cam-label-current')).toHaveTextContent('Po');
  });

  it('capture click writes via storePhoto with the selected angle', async () => {
    const onCaptured = vi.fn();
    const { container } = render(
      <CameraCard
        db={fakeDb}
        vaultId="vault-1"
        customerId="customer:1"
        onCaptured={onCaptured}
      />,
    );
    const user = userEvent.setup();
    // Switch to "after".
    const chip = await waitFor(() => container.querySelector<HTMLElement>('.cam-label-chip')!);
    await user.click(chip);
    await user.click(await screen.findByRole('menuitemradio', { name: /Po/i }));

    // Mock video dimensions so the canvas drawImage path runs.
    const video = container.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { value: 1280, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 720, configurable: true });

    // Capture any error rendered into the .cam-error region for debugging.
    const captureBtn = screen.getByRole('button', { name: /Pořídit fotografii/i });
    await user.click(captureBtn);

    await waitFor(
      () => {
        const err = container.querySelector('.cam-error');
        if (err) throw new Error(`Cam error rendered: ${err.textContent}`);
        expect(storePhoto).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    const call = (storePhoto as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].meta.angle).toBe('after');
    expect(call[1].meta.label).toBe('Po');
    expect(call[1].meta.customerId).toBe('customer:1');
    expect(onCaptured).toHaveBeenCalledWith('photo-meta:abc');
  });
});
