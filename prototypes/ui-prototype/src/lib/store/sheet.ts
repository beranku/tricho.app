import { atom } from 'nanostores';

/**
 * Currently open sheet ID, or null if none.
 * Multiple islands subscribe — e.g. BottomSheet shows itself, FAB hides.
 */
export const openSheetId = atom<string | null>(null);

export function openSheet(id: string): void {
  openSheetId.set(id);
}

export function closeSheet(): void {
  openSheetId.set(null);
}

export function isSheetOpen(id: string): boolean {
  return openSheetId.get() === id;
}
