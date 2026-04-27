import { atom } from 'nanostores';

/**
 * Position of "today" section relative to current scroll viewport.
 * - 'in-view' — user is inside today section
 * - 'past' — user scrolled up into past days (today is below)
 * - 'future' — user scrolled down into future days (today is above)
 *
 * Updated by <PhoneScroll> island, subscribed by <FabSecondary>.
 */
export type TodayPosition = 'in-view' | 'past' | 'future';

export const todayPosition = atom<TodayPosition>('in-view');
