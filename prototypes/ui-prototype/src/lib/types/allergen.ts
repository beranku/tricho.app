/**
 * Chemical allergen that client may react to.
 * Listed in "Amoniak", "PPD", "Resorcinol" etc.
 * Displayed as Caveat amber badge in current-head / client detail.
 */
export interface Allergen {
  /** Short ID like "ammonia", "ppd", "resorcinol" */
  id: string;
  /** Czech display name (capitalized) */
  name: string;
  /** Optional chemical description */
  description?: string;
  /** Severity — impacts visual prominence */
  severity: 'mild' | 'moderate' | 'severe';
}

/** Common allergens predefined in the app */
export const COMMON_ALLERGENS: readonly Allergen[] = [
  { id: 'ammonia', name: 'Amoniak', severity: 'severe' },
  { id: 'ppd', name: 'PPD', severity: 'severe' },
  { id: 'resorcinol', name: 'Resorcinol', severity: 'moderate' },
  { id: 'parabens', name: 'Parabeny', severity: 'moderate' },
  { id: 'fragrance', name: 'Parfemace', severity: 'mild' }
] as const;
