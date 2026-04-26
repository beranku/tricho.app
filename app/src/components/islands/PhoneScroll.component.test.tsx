import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PhoneScroll } from './PhoneScroll';

describe('PhoneScroll', () => {
  beforeEach(() => {
    // Spy on scrollIntoView so we can verify the today section was scrolled.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders children inside a scroll container with top + bottom spacers', () => {
    const { container } = render(
      <PhoneScroll>
        <section data-day="2026-04-25" data-today="true">today</section>
      </PhoneScroll>,
    );
    expect(container.querySelector('.phone-scroll')).toBeInTheDocument();
    expect(container.querySelector('.scroll-topspacer')).toBeInTheDocument();
    expect(container.querySelector('.scroll-bottomspacer')).toBeInTheDocument();
  });

  it('scrolls the data-today section into view on mount', () => {
    render(
      <PhoneScroll>
        <section data-day="2026-04-25" data-today="true">today</section>
      </PhoneScroll>,
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('does not scroll if there is no data-today section', () => {
    render(
      <PhoneScroll>
        <section data-day="2026-04-25">past</section>
      </PhoneScroll>,
    );
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('respects custom bottomGap prop', () => {
    const { container } = render(
      <PhoneScroll bottomGap={200}>
        <section data-day="2026-04-25" />
      </PhoneScroll>,
    );
    const spacer = container.querySelector<HTMLElement>('.scroll-bottomspacer');
    expect(spacer?.style.height).toBe('200px');
  });
});
