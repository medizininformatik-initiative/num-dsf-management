/**
 * StatusPill.test.tsx — each tone renders the matching classes from the shared
 * tone scale (TONE_CLASS), neutral is the default, and the optional icon is
 * decorative so the pill is announced by its text alone.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from '../StatusPill';
import { TONE_CLASS, type StatusTone } from '../../../lib/statusColors';

describe('StatusPill', () => {
  it('defaults to the neutral tone', () => {
    render(<StatusPill>Draft</StatusPill>);
    const pill = screen.getByText('Draft');
    expect(pill).toHaveClass('pill', ...TONE_CLASS.neutral.split(' '));
  });

  it.each<StatusTone>(['success', 'warning', 'danger', 'info'])('renders the %s tone', (tone) => {
    render(<StatusPill tone={tone}>Label</StatusPill>);
    expect(screen.getByText('Label')).toHaveClass(...TONE_CLASS[tone].split(' '));
  });

  it('renders a decorative leading icon', () => {
    render(
      <StatusPill tone="success" icon="check_circle">
        Approved
      </StatusPill>,
    );
    const pill = screen.getByText('Approved');
    const icon = pill.querySelector('.material-symbols-outlined');
    expect(icon).toHaveTextContent('check_circle');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
