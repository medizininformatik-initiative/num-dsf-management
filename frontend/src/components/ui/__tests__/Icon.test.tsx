/**
 * Icon.test.tsx — the Material Symbols wrapper is hidden from assistive tech by
 * default (the ligature text such as "delete" must not be read out), and becomes
 * an image with an accessible name when given a label. Size, fill and extra
 * classes pass through to the span.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Icon } from '../Icon';

describe('Icon', () => {
  it('is decorative by default', () => {
    const { container } = render(<Icon name="delete" />);
    const icon = container.querySelector('span')!;
    expect(icon).toHaveClass('material-symbols-outlined');
    expect(icon).toHaveTextContent('delete');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).not.toHaveAttribute('role');
    expect(icon).toHaveAttribute('translate', 'no');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('becomes a labelled image when given a label', () => {
    render(<Icon name="warning" label="Certificate expires soon" />);
    const icon = screen.getByRole('img', { name: 'Certificate expires soon' });
    expect(icon).not.toHaveAttribute('aria-hidden');
    expect(icon).toHaveTextContent('warning');
  });

  it('applies size, fill and extra classes', () => {
    const { container } = render(<Icon name="star" size={18} filled className="text-primary" />);
    const icon = container.querySelector('span')!;
    expect(icon).toHaveClass('text-primary');
    expect(icon.style.fontSize).toBe('18px');
    expect(icon.style.fontVariationSettings).toBe("'FILL' 1");
  });
});
