/**
 * IntroSlides.test.tsx – the intro deck starts on slide 1, steps with the prev/next
 * buttons (disabled at the ends), jumps through the dots, reacts to ArrowLeft/ArrowRight
 * and to a touch swipe, and marks only the current slide as available.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntroSlides } from '../IntroSlides';
import { useI18n } from '../../../stores/i18n.store';

// jsdom has no PointerEvent; a MouseEvent carrying pointerType is enough here.
class TestPointerEvent extends MouseEvent {
  pointerType: string;
  constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

function counter() {
  return screen.getByText(/^\d+ \/ 10$/).textContent;
}

describe('IntroSlides', () => {
  it('shows ten slides as a carousel and starts on the first', () => {
    useI18n.setState({ lang: 'de' });
    render(<IntroSlides />);
    expect(screen.getByRole('region', { name: /Einführung/ })).toHaveAttribute(
      'aria-roledescription',
      'carousel',
    );
    expect(document.querySelectorAll('[aria-roledescription="slide"]')).toHaveLength(10);
    expect(counter()).toBe('1 / 10');
    expect(screen.getByRole('group', { name: '1 von 10' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Vorherige Folie' })).toBeDisabled();
  });

  it('steps with the prev and next buttons and stops at the ends', async () => {
    useI18n.setState({ lang: 'en' });
    const user = userEvent.setup();
    render(<IntroSlides />);
    const next = screen.getByRole('button', { name: 'Next slide' });
    await user.click(next);
    expect(counter()).toBe('2 / 10');
    await user.click(screen.getByRole('button', { name: 'Previous slide' }));
    expect(counter()).toBe('1 / 10');
    for (let i = 0; i < 9; i++) await user.click(next);
    expect(counter()).toBe('10 / 10');
    expect(next).toBeDisabled();
  });

  it('jumps through the dots and marks the current one', async () => {
    useI18n.setState({ lang: 'en' });
    const user = userEvent.setup();
    render(<IntroSlides />);
    await user.click(screen.getByRole('button', { name: 'Go to slide 4' }));
    expect(counter()).toBe('4 / 10');
    expect(screen.getByRole('button', { name: 'Go to slide 4' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Go to slide 1' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('follows ArrowRight and ArrowLeft while the deck has focus', async () => {
    useI18n.setState({ lang: 'en' });
    const user = userEvent.setup();
    render(<IntroSlides />);
    screen.getByRole('region').focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(counter()).toBe('3 / 10');
    await user.keyboard('{ArrowLeft}');
    expect(counter()).toBe('2 / 10');
  });

  it('changes slide on a touch swipe past the threshold only', () => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    useI18n.setState({ lang: 'en' });
    render(<IntroSlides />);
    const surface = document.querySelector('.touch-pan-y') as HTMLElement;
    fireEvent.pointerDown(surface, { pointerType: 'touch', clientX: 200 });
    fireEvent.pointerUp(surface, { pointerType: 'touch', clientX: 170 });
    expect(counter()).toBe('1 / 10');
    fireEvent.pointerDown(surface, { pointerType: 'touch', clientX: 200 });
    fireEvent.pointerUp(surface, { pointerType: 'touch', clientX: 120 });
    expect(counter()).toBe('2 / 10');
    fireEvent.pointerDown(surface, { pointerType: 'touch', clientX: 100 });
    fireEvent.pointerUp(surface, { pointerType: 'touch', clientX: 180 });
    expect(counter()).toBe('1 / 10');
    vi.unstubAllGlobals();
  });
});
