import { useStore } from '@nanostores/react';
import { openSheetId, openSheet, closeSheet } from '../../../lib/store/sheet';

/**
 * React-side hook for bottom sheet state.
 * Returns whether THIS sheet (by id) is currently open, plus open/close controls.
 */
export function useBottomSheet(id: string): {
  isOpen: boolean;
  open: () => void;
  close: () => void;
} {
  const current = useStore(openSheetId);
  return {
    isOpen: current === id,
    open: () => openSheet(id),
    close: () => closeSheet()
  };
}
