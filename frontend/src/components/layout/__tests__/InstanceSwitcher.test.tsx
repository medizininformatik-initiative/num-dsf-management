/**
 * InstanceSwitcher.test.tsx – alphabetical order, pinned-first, and the
 * search field (hidden up to 5 instances, filtering, Escape clears, no-matches).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useCanvasStore } from '../../../stores/canvas.store';

const mockInstances = vi.hoisted(() => ({ list: [] as { id: string; label: string }[] }));
vi.mock('../../../hooks/useInstance', () => ({
  useInstances: () => ({ data: mockInstances.list, isLoading: false }),
}));

import { InstanceSwitcher } from '../InstanceSwitcher';

const LABELS = ['uke.de', 'ukaachen.de', 'charite.de', 'ukm.de', 'Zeta.de', 'alpha.de'];
const make = (labels: string[]) => labels.map((label, i) => ({ id: `i${i}`, label }));

function rowLabels() {
  return screen.getAllByRole('listitem').map((li) => li.querySelector('button')?.textContent ?? '');
}

beforeEach(() => {
  localStorage.clear();
  useCanvasStore.setState({ activeInstanceId: null });
  mockInstances.list = make(LABELS);
});

describe('InstanceSwitcher', () => {
  it('sorts instances alphabetically, case-insensitively', () => {
    renderWithProviders(<InstanceSwitcher />, { route: '/app' });
    expect(rowLabels()).toEqual([
      'alpha.de',
      'charite.de',
      'ukaachen.de',
      'uke.de',
      'ukm.de',
      'Zeta.de',
    ]);
  });

  it('keeps pinned instances first, alphabetical within each group', () => {
    localStorage.setItem('dsf-pinned-instances', JSON.stringify(['i0', 'i4']));
    renderWithProviders(<InstanceSwitcher />, { route: '/app' });
    expect(rowLabels()).toEqual([
      'uke.de',
      'Zeta.de',
      'alpha.de',
      'charite.de',
      'ukaachen.de',
      'ukm.de',
    ]);
  });

  it('hides the search field with 5 or fewer instances', () => {
    mockInstances.list = make(LABELS.slice(0, 5));
    renderWithProviders(<InstanceSwitcher />, { route: '/app' });
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('shows the search field with more than 5 instances', () => {
    renderWithProviders(<InstanceSwitcher />, { route: '/app' });
    expect(screen.getByRole('searchbox', { name: 'Search instances' })).toBeInTheDocument();
  });

  it('filters by case-insensitive substring', async () => {
    renderWithProviders(<InstanceSwitcher />, { route: '/app' });
    await userEvent.type(screen.getByRole('searchbox'), 'UK');
    expect(rowLabels()).toEqual(['ukaachen.de', 'uke.de', 'ukm.de']);
  });

  it('clears the field on Escape', async () => {
    renderWithProviders(<InstanceSwitcher />, { route: '/app' });
    const input = screen.getByRole('searchbox');
    await userEvent.type(input, 'uk');
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveValue('');
    expect(rowLabels()).toHaveLength(6);
  });

  it('shows a no-matches line when nothing matches', async () => {
    renderWithProviders(<InstanceSwitcher />, { route: '/app' });
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
