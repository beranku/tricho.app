/**
 * Bottom-sheet open/close state — shared across islands.
 *
 * Only one sheet open at a time. The trigger element id is captured so
 * BottomSheet can return focus on close.
 */
import { atom } from 'nanostores';

export type SheetType = 'menu' | 'fab-add' | 'context';

export interface SheetState {
  open: boolean;
  type: SheetType | null;
  triggerId: string | null;
  payload?: { startAt?: number };
}

export const sheetStore = atom<SheetState>({
  open: false,
  type: null,
  triggerId: null,
});

export function openSheet(type: SheetType, options: { triggerId?: string; payload?: SheetState['payload'] } = {}): void {
  sheetStore.set({
    open: true,
    type,
    triggerId: options.triggerId ?? null,
    payload: options.payload,
  });
}

export function closeSheet(): void {
  sheetStore.set({ open: false, type: null, triggerId: null });
}
