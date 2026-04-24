import { describe, it, expect } from 'vitest';
import { PhotoCapture } from './PhotoCapture';

// PhotoCapture uses getUserMedia (polyfilled in component-setup.ts),
// createImageBitmap, canvas.toBlob, and the VaultDb for storage. Real
// coverage needs:
//  - a fake MediaStream returning a real frame (stubbed via the shared
//    component-setup polyfill)
//  - an in-memory VaultDb so storePhoto + listPhotoIds round-trip
// Shipped as scaffold while those helpers are finished.

describe('PhotoCapture', () => {
  it('module exports the component', () => {
    expect(typeof PhotoCapture).toBe('function');
  });

  it.todo('mount initialises camera via getUserMedia');
  it.todo('capture stores an encrypted photo in the vault');
  it.todo('camera permission denied → renders instructions');
  it.todo('delete removes the photo + re-renders the list');
});
