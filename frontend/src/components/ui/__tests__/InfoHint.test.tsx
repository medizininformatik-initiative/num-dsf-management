import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InfoHint } from '../InfoHint';

describe('InfoHint', () => {
  it('is hidden until activated, then shows the text and is dismissible', () => {
    render(<InfoHint text="Data Integration Center" label="Was ist DIC?" />);
    const btn = screen.getByRole('button', { name: 'Was ist DIC?' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(btn);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Data Integration Center');
    expect(btn).toHaveAttribute('aria-describedby', tip.id);
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes only the hint on Escape (default prevented) and has a translated default label', () => {
    render(<InfoHint text="Explanation" />);
    const btn = screen.getByRole('button', { name: 'More information' });
    fireEvent.click(btn);
    expect(fireEvent.keyDown(btn, { key: 'Escape' })).toBe(false);
    expect(screen.queryByRole('tooltip')).toBeNull();
    // With the hint closed, Escape is left alone so a surrounding modal can close.
    expect(fireEvent.keyDown(btn, { key: 'Escape' })).toBe(true);
  });
});
