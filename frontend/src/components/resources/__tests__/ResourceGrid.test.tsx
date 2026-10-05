/**
 * ResourceGrid.test.tsx — motion choreography of the resources grid: staggered
 * entrance on mount, removed cards kept as aria-hidden scale-out ghosts until
 * the exit duration elapses, cards that stay get a FLIP transition on the
 * spring token, and no FLIP under Reduce Motion. jsdom has no layout, so the
 * li offsets are faked from the element's index in the list (100px per row).
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { ResourceGrid } from '../ResourceGrid';
import { DSF_RESOURCES } from '../../../lib/dsfResources';
import { exitMs } from '../../../lib/motion';

const [a, b, c] = DSF_RESOURCES;
const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function li(id: string) {
  return document.querySelector(`a[href="${DSF_RESOURCES.find((r) => r.id === id)!.url}"]`)!
    .parentElement as HTMLLIElement;
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.tagName !== 'LI' || !this.parentElement) return 0;
      return Array.from(this.parentElement.children).indexOf(this) * 100;
    },
  });
  setReducedMotion(false);
});

afterEach(() => {
  if (original) Object.defineProperty(HTMLElement.prototype, 'offsetTop', original);
  vi.useRealTimers();
});

describe('ResourceGrid', () => {
  it('staggers the entrance of every card on mount', () => {
    renderWithProviders(<ResourceGrid resources={[a, b, c]} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    links.forEach((link, i) => {
      expect(link).toHaveClass('animate-list-item-in');
      expect(link.style.getPropertyValue('--stagger-index')).toBe(String(i));
    });
  });

  it('keeps removed cards as aria-hidden scale-out ghosts for the exit duration', () => {
    vi.useFakeTimers();
    const { rerender } = renderWithProviders(<ResourceGrid resources={[a, b, c]} />);
    rerender(<ResourceGrid resources={[c]} />);
    const ghosts = screen.getAllByTestId('resource-ghost');
    expect(ghosts).toHaveLength(2);
    for (const g of ghosts) {
      expect(g).toHaveAttribute('aria-hidden', 'true');
      expect(g).toHaveClass('animate-scale-out', 'absolute');
    }
    expect(screen.getAllByRole('link')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(exitMs('medium'));
    });
    expect(screen.queryAllByTestId('resource-ghost')).toHaveLength(0);
  });

  it('glides cards that stay to their new cell on the spring easing token', () => {
    const { rerender } = renderWithProviders(<ResourceGrid resources={[a, b, c]} />);
    rerender(<ResourceGrid resources={[c]} />);
    const moved = li(c.id);
    expect(moved.style.transition).toBe('transform var(--duration-medium) var(--ease-spring)');
    expect(moved.style.transform).toBe('');
  });

  it('starts cards added later one stagger step after the exits', () => {
    const { rerender } = renderWithProviders(<ResourceGrid resources={[a]} />);
    rerender(<ResourceGrid resources={[a, b]} />);
    const added = screen.getByRole('link', { name: new RegExp(b.title) });
    expect(added.style.getPropertyValue('--stagger-index')).toBe('1');
  });

  it('does not move cards under Reduce Motion', () => {
    setReducedMotion(true);
    const { rerender } = renderWithProviders(<ResourceGrid resources={[a, b, c]} />);
    rerender(<ResourceGrid resources={[c]} />);
    expect(li(c.id).style.transition).toBe('');
  });
});
