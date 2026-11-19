/**
 * MapLegend.test.tsx – the legend strip is collapsed by default, expands into
 * headed groups, remembers its state and survives blocked storage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { MapLegend, LEGEND_STORAGE_KEY } from '../MapLegend';

describe('MapLegend', () => {
  beforeEach(() => localStorage.clear());

  it('is collapsed by default', () => {
    renderWithProviders(<MapLegend />);
    const toggle = screen.getByRole('button', { name: /Legend/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('expands into groups headed by the encoded element and remembers it', () => {
    renderWithProviders(<MapLegend />);
    fireEvent.click(screen.getByRole('button', { name: /Legend/ }));
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Certificate status (pin ring)',
      'Activity (ring style)',
      'Several sites (ring segments)',
      'Verbund (line colour)',
    ]);
    expect(screen.getByText('Valid')).toBeInTheDocument();
    expect(screen.getByText('Expiring')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('No cert')).toBeInTheDocument();
    expect(localStorage.getItem(LEGEND_STORAGE_KEY)).toBe('1');
  });

  it('starts open when it was left open', () => {
    localStorage.setItem(LEGEND_STORAGE_KEY, '1');
    renderWithProviders(<MapLegend />);
    expect(screen.getByRole('button', { name: /Legend/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('still works when storage throws', () => {
    renderWithProviders(<MapLegend />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    fireEvent.click(screen.getByRole('button', { name: /Legend/ }));
    expect(screen.getByRole('button', { name: /Legend/ })).toHaveAttribute('aria-expanded', 'true');
    vi.restoreAllMocks();
  });
});
