import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { MapFilters, type MapFilterState } from '../MapFilters';

function makeState(overrides: Partial<MapFilterState> = {}): MapFilterState {
  return {
    query: '',
    activeMode: 'all',
    certStatuses: new Set(),
    ...overrides,
  };
}

describe('MapFilters', () => {
  it('renders the search placeholder, mode buttons and status chips', () => {
    renderWithProviders(
      <MapFilters
        state={makeState()}
        onChange={vi.fn()}
        totalCount={10}
        visibleCount={4}
        cityCount={3}
        showAllEdges={false}
        onToggleShowAllEdges={vi.fn()}
        verbundPills={<div>pills-slot</div>}
      />,
    );
    expect(screen.getByText('Valid')).toBeInTheDocument();
    expect(screen.getByText('pills-slot')).toBeInTheDocument();
    expect(screen.getByText(/Showing 4 of 10 sites in 3 cities/)).toBeInTheDocument();
  });

  it('toggles a cert status on chip click', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MapFilters
        state={makeState()}
        onChange={onChange}
        totalCount={10}
        visibleCount={4}
        cityCount={3}
        showAllEdges={false}
        onToggleShowAllEdges={vi.fn()}
        verbundPills={null}
      />,
    );
    await userEvent.click(screen.getByText('Valid'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as MapFilterState;
    expect(next.certStatuses.has('VALID')).toBe(true);
  });

  it('invokes onToggleShowAllEdges on the connections button', async () => {
    const onToggleShowAllEdges = vi.fn();
    renderWithProviders(
      <MapFilters
        state={makeState()}
        onChange={vi.fn()}
        totalCount={10}
        visibleCount={4}
        cityCount={3}
        showAllEdges={false}
        onToggleShowAllEdges={onToggleShowAllEdges}
        verbundPills={null}
      />,
    );
    await userEvent.click(screen.getByText('Show all connections'));
    expect(onToggleShowAllEdges).toHaveBeenCalledTimes(1);
  });

  it('exposes toggle states through aria-pressed', () => {
    renderWithProviders(
      <MapFilters
        state={makeState({ activeMode: 'active', certStatuses: new Set(['EXPIRED']) })}
        onChange={vi.fn()}
        totalCount={10}
        visibleCount={4}
        cityCount={3}
        showAllEdges
        onToggleShowAllEdges={vi.fn()}
        verbundPills={null}
      />,
    );
    expect(screen.getByRole('button', { name: 'active' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'all' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Expired' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Valid' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Show all connections' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('switches the activity segment', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MapFilters
        state={makeState()}
        onChange={onChange}
        totalCount={10}
        visibleCount={4}
        cityCount={3}
        showAllEdges={false}
        onToggleShowAllEdges={vi.fn()}
        verbundPills={null}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'inactive' }));
    expect((onChange.mock.calls[0][0] as MapFilterState).activeMode).toBe('inactive');
  });

  it('clears the search with the clear button and renders the leading slot', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <MapFilters
        state={makeState({ query: 'ukm' })}
        onChange={onChange}
        totalCount={10}
        visibleCount={4}
        cityCount={3}
        showAllEdges={false}
        onToggleShowAllEdges={vi.fn()}
        verbundPills={null}
        leading={<span>leading-slot</span>}
      />,
    );
    expect(screen.getByText('leading-slot')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search organizations' })).toHaveValue('ukm');
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect((onChange.mock.calls[0][0] as MapFilterState).query).toBe('');
  });
});
