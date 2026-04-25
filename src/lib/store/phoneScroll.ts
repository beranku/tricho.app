/**
 * Schedule scroll state — observed by FabSecondary.
 *
 * `todayInView` is true when the today-section's sticky header is intersecting
 * the visible viewport; FabSecondary hides itself when this is true.
 *
 * `todayDirection` indicates whether today is above or below the viewport
 * when out of view, so the secondary FAB can render the correct arrow.
 */
import { atom } from 'nanostores';

export interface PhoneScrollState {
  stuckDay: string | null;
  todayInView: boolean;
  todayDirection: 'up' | 'down' | null;
}

export const phoneScrollStore = atom<PhoneScrollState>({
  stuckDay: null,
  todayInView: false,
  todayDirection: null,
});
