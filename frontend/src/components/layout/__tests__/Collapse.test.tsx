/**
 * Collapse.test.tsx – disclosure content: shown at once when open on mount,
 * animated (grid rows 0fr ↔ 1fr) only after a change, hidden from assistive
 * tech while closing, and unmounted afterwards.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Collapse } from '../Collapse';

const wrapper = () => document.getElementById('c1') as HTMLElement;

describe('Collapse', () => {
  it('renders open content on mount without an entrance animation', () => {
    render(
      <Collapse id="c1" open>
        body
      </Collapse>,
    );
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(wrapper()).toHaveAttribute('data-state', 'open');
    expect(wrapper().className).not.toContain('animate-expand-in');
  });

  it('renders nothing while closed', () => {
    render(
      <Collapse id="c1" open={false}>
        body
      </Collapse>,
    );
    expect(screen.queryByText('body')).not.toBeInTheDocument();
  });

  it('grows in after opening and shrinks out before unmounting', async () => {
    const { rerender } = render(
      <Collapse id="c1" open={false}>
        body
      </Collapse>,
    );
    rerender(
      <Collapse id="c1" open>
        body
      </Collapse>,
    );
    expect(wrapper().className).toContain('data-[state=open]:animate-expand-in');

    rerender(
      <Collapse id="c1" open={false}>
        body
      </Collapse>,
    );
    expect(wrapper()).toHaveAttribute('data-state', 'closed');
    expect(wrapper()).toHaveAttribute('aria-hidden', 'true');
    expect(wrapper().className).toContain('data-[state=closed]:animate-expand-out');
    await waitFor(() => expect(screen.queryByText('body')).not.toBeInTheDocument());
  });
});
