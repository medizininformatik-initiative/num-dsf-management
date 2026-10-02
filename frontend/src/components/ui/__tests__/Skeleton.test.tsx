/**
 * Skeleton.test.tsx — the loading-placeholder primitives render the right number
 * of shimmering bars. Skeleton emits one decorative bar per `lines` (default 3),
 * applies an extra `className` to every bar, varies bar widths by index and
 * tells screen readers it is loading. Bars use the theme-aware .skeleton class
 * rather than a fixed light colour. CardSkeleton wraps a four-line Skeleton in a
 * card shell on the card surface token.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton, CardSkeleton } from '../Skeleton';
import { useI18n } from '../../../stores/i18n.store';

/** The shimmering bars are the leaf divs carrying the bar height class. */
function bars(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('div.skeleton.h-3.rounded-full'));
}

describe('Skeleton', () => {
  beforeEach(() => {
    useI18n.getState().setLang('en');
  });

  it('renders three decorative bars by default and a loading label', () => {
    const { container } = render(<Skeleton />);

    const rendered = bars(container);
    expect(rendered).toHaveLength(3);
    for (const bar of rendered) {
      expect(bar).toHaveAttribute('aria-hidden', 'true');
      expect(bar).not.toHaveClass('bg-slate-100');
    }
    expect(screen.getByText('Loading…')).toHaveClass('sr-only');
  });

  it('renders exactly `lines` placeholder bars', () => {
    const { container } = render(<Skeleton lines={5} />);
    expect(bars(container)).toHaveLength(5);
  });

  it('renders no bars when lines is zero', () => {
    const { container } = render(<Skeleton lines={0} />);
    expect(bars(container)).toHaveLength(0);
  });

  it('applies the extra className to every bar', () => {
    const { container } = render(<Skeleton lines={3} className="opacity-50" />);
    const rendered = bars(container);
    expect(rendered).toHaveLength(3);
    for (const bar of rendered) {
      expect(bar).toHaveClass('opacity-50');
    }
  });

  it('varies bar widths by index (first 3/4, even half, odd full)', () => {
    const { container } = render(<Skeleton lines={4} />);
    const rendered = bars(container);
    expect(rendered).toHaveLength(4);
    expect(rendered[0]).toHaveClass('w-3/4'); // i === 0
    expect(rendered[1]).toHaveClass('w-full'); // odd
    expect(rendered[2]).toHaveClass('w-1/2'); // even, non-zero
    expect(rendered[3]).toHaveClass('w-full'); // odd
  });
});

describe('CardSkeleton', () => {
  it('renders a card shell wrapping a four-line skeleton', () => {
    const { container } = render(<CardSkeleton />);

    const shell = container.querySelector('div.entity-card-shadow');
    expect(shell).not.toBeNull();
    expect(shell).not.toHaveClass('bg-white');

    // The nested Skeleton is rendered with lines={4}.
    expect(bars(container)).toHaveLength(4);
  });
});
