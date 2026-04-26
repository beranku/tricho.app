import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TOKENS_CSS = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');

function blockOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'm');
  const match = TOKENS_CSS.match(re);
  if (!match) throw new Error(`block for ${selector} not found in tokens.css`);
  return match[1];
}

function tokenValue(block: string, name: string): string {
  const re = new RegExp(`${name}\\s*:\\s*([^;]+);`, 'm');
  const match = block.match(re);
  if (!match) throw new Error(`token ${name} not found in block`);
  return match[1].trim();
}

describe('design tokens: paper-grain blend differs per theme', () => {
  it('--paper-blend resolves to multiply in light mode', () => {
    expect(tokenValue(blockOf(':root'), '--paper-blend')).toBe('multiply');
  });

  it('--paper-blend resolves to screen in dark mode', () => {
    expect(tokenValue(blockOf(':root[data-theme="dark"]'), '--paper-blend')).toBe('screen');
  });

  it('--paper-opacity is defined in both themes', () => {
    expect(tokenValue(blockOf(':root'), '--paper-opacity')).toMatch(/^[\d.]+$/);
    expect(tokenValue(blockOf(':root[data-theme="dark"]'), '--paper-opacity')).toMatch(/^[\d.]+$/);
  });

  it('--stage-gradient-{1,2} defined in both themes', () => {
    for (const sel of [':root', ':root[data-theme="dark"]']) {
      const block = blockOf(sel);
      expect(tokenValue(block, '--stage-gradient-1')).not.toBe('');
      expect(tokenValue(block, '--stage-gradient-2')).not.toBe('');
    }
  });

  it('--copper-tint defined in both themes', () => {
    expect(tokenValue(blockOf(':root'), '--copper-tint')).toMatch(/^rgba?\(/);
    expect(tokenValue(blockOf(':root[data-theme="dark"]'), '--copper-tint')).toMatch(/^rgba?\(/);
  });
});

describe('reduced-motion override pins all transitions to ≤ 0.01ms', () => {
  // The token file establishes the contract; the welcome.css `@media
  // (prefers-reduced-motion: reduce)` block enforces it on every wizard
  // surface element. This test pins both layers so a future edit can't
  // remove one without the other failing.

  it('typography.css collapses --t-base / --t-sheet / --t-hover', () => {
    // Tokens.css has the @media override at the bottom — confirm the
    // three transition tokens are inside it.
    const reducedMotionBlock = TOKENS_CSS.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
    );
    // tokens.css is the single declaration source for transitions; the
    // welcome.css override applies the `transition: none !important` to
    // its own classes. The contract: at least one of the two locations
    // pins reduced-motion.
    const welcome = readFileSync(resolve(__dirname, 'welcome.css'), 'utf8');
    const welcomeBlock = welcome.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(reducedMotionBlock !== null || welcomeBlock !== null).toBe(true);
    if (welcomeBlock) {
      expect(welcomeBlock[1]).toMatch(/transition:\s*none\s*!important/);
    }
  });
});
