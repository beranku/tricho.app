import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { StepCard } from './StepCard';

/**
 * The opacity hierarchy contract from the `ui-design-system` capability
 * delta:
 *
 *   - locked: 0.62
 *   - active: 1.0
 *   - done:   0.5  (strictly less than locked)
 *
 * jsdom doesn't apply our stylesheet, so we read the welcome.css source
 * and assert the rule definitions directly. This catches accidental
 * regressions where a developer flips the relative ordering.
 */
const WELCOME_CSS = readFileSync(
  resolve(__dirname, '../../styles/welcome.css'),
  'utf8',
);

function findOpacity(state: 'locked' | 'active' | 'done'): number {
  const re = new RegExp(
    `\\.step-card\\[data-state='${state}'\\]\\s*\\{([^}]*)\\}`,
    's',
  );
  const block = WELCOME_CSS.match(re);
  if (!block) throw new Error(`block for ${state} not found`);
  const op = block[1].match(/opacity:\s*([\d.]+)/);
  if (!op) throw new Error(`opacity not found for ${state}`);
  return Number(op[1]);
}

describe('StepCard opacity hierarchy', () => {
  it('done is strictly less than locked, both less than active', () => {
    const locked = findOpacity('locked');
    const active = findOpacity('active');
    const done = findOpacity('done');
    expect(active).toBe(1);
    expect(locked).toBe(0.62);
    expect(done).toBe(0.5);
    // The whole point: done MUST be more recessed than locked.
    expect(done).toBeLessThan(locked);
  });
});

describe('StepCard markup', () => {
  it('locked renders lock-icon in the right slot AND the step number in the marker', () => {
    const { container, rerender } = render(
      <StepCard step={2} state="locked" kicker="K" title="T" />,
    );
    // Lock icon lives in the right-slot, not the marker.
    expect(container.querySelector('.step-card__lock svg')).not.toBeNull();
    expect(container.querySelector('.step-card__marker')?.textContent).toBe('2');

    rerender(<StepCard step={2} state="active" kicker="K" title="T" />);
    expect(container.querySelector('.step-card__marker')?.textContent).toBe('2');
    expect(container.querySelector('.step-card__lock svg')).toBeNull();

    rerender(<StepCard step={2} state="done" kicker="K" title="T" />);
    // Done swaps the marker contents for the hand-drawn check svg.
    expect(container.querySelector('.step-card__marker svg')).not.toBeNull();
    expect(container.querySelector('.step-card__lock svg')).toBeNull();
  });

  it('aria-label encodes step state for screen readers', () => {
    const { container, rerender } = render(
      <StepCard step={2} state="locked" kicker="K" title="Přihlášení" />,
    );
    const card = container.querySelector('.step-card')!;
    expect(card.getAttribute('aria-label')).toContain('Přihlášení');
    expect(card.getAttribute('aria-label')).toContain('uzamčeno');

    rerender(<StepCard step={2} state="done" kicker="K" title="Přihlášení" />);
    expect(container.querySelector('.step-card')!.getAttribute('aria-label')).toContain('hotovo');

    rerender(<StepCard step={2} state="active" kicker="K" title="Přihlášení" />);
    expect(container.querySelector('.step-card')!.getAttribute('aria-label')).toContain('aktivní krok');
  });
});
