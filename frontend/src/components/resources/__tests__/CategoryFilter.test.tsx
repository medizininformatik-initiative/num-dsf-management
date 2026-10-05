/**
 * CategoryFilter.test.tsx — the segmented category picker: a labelled group of
 * aria-pressed buttons with counts, onChange on click, and a single sliding
 * selection pill placed on the active button.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { CategoryFilter } from '../CategoryFilter';
import type { CategoryFilter as Filter } from '../../../lib/dsfResources';

const counts: Record<Filter, number> = {
  all: 9,
  gettingStarted: 2,
  documentation: 2,
  processPlugins: 1,
  specifications: 1,
  community: 2,
  networks: 1,
};

describe('CategoryFilter', () => {
  it('renders a labelled group with All plus every category and its count', () => {
    renderWithProviders(<CategoryFilter value="all" onChange={() => {}} counts={counts} />);
    const group = screen.getByRole('group', { name: 'Filter by category' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'All 9' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Process plugins 1' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getAllByTestId('category-pill')).toHaveLength(1);
  });

  it('reports the chosen category', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<CategoryFilter value="all" onChange={onChange} counts={counts} />);
    await user.click(screen.getByRole('button', { name: /Specifications/ }));
    expect(onChange).toHaveBeenCalledWith('specifications');
  });
});
