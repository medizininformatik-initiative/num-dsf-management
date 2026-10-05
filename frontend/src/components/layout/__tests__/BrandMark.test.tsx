/**
 * BrandMark.test.tsx – the product name is real text, the gradient glyph is
 * decorative and hidden from assistive tech, two marks never share SVG ids,
 * and every animation of the mark sits behind prefers-reduced-motion.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandMark } from '../BrandMark';

describe('BrandMark', () => {
  it('renders the untranslated product name as text', () => {
    render(<BrandMark />);
    expect(screen.getByText('DSF Management Tool')).toBeInTheDocument();
  });

  it('hides the decorative glyph from assistive tech and fills it with the gradient', () => {
    render(<BrandMark size={32} />);
    const glyph = screen.getByTestId('brand-mark-glyph');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph).toHaveAttribute('width', '32');
    const gradient = glyph.querySelector('linearGradient');
    expect(gradient?.querySelectorAll('stop')).toHaveLength(4);
    expect(glyph.querySelector('.bm-core')).toHaveAttribute('fill', `url(#${gradient?.id})`);
  });

  it('gives each mark its own gradient and mask ids', () => {
    render(
      <>
        <BrandMark />
        <BrandMark />
      </>,
    );
    const ids = Array.from(document.querySelectorAll('linearGradient, mask')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[\w-]+$/.test(id))).toBe(true);
  });

  it('carries the motion class and animates only without Reduce Motion', () => {
    render(<BrandMark />);
    // brand-mark.css declares its animations only for no-preference; the
    // motion-reduce class stops any animation inside the glyph as well.
    expect(screen.getByTestId('brand-mark-glyph')).toHaveClass(
      'brand-mark',
      'motion-reduce:[&_*]:!animate-none',
    );
  });

  it('passes extra classes to the name, e.g. the rail fade', () => {
    render(<BrandMark nameClassName="opacity-0" />);
    expect(screen.getByText('DSF Management Tool')).toHaveClass('opacity-0');
  });
});
