import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { GeoMapCluster } from '../GeoMapCluster';
import { clusterKeyOf } from '../mapGeometry';
import type { MapOrganization, MapClusterGroup } from '../../../api/network.api';

function member(id: string, status: MapOrganization['cert_status']): MapOrganization {
  return {
    identifier: id,
    name: id,
    active: true,
    city: 'Berlin',
    country_code: 'DE',
    cert_status: status,
    endpoints: [],
    memberships: [],
  };
}

const group: MapClusterGroup = {
  city: 'Berlin',
  country_code: 'DE',
  members: [member('a.de', 'VALID'), member('b.de', 'EXPIRED')],
  worstStatus: 'EXPIRED',
};

describe('GeoMapCluster', () => {
  it('renders a count bubble named after the city and its site count', () => {
    renderWithProviders(
      <svg>
        <GeoMapCluster
          group={group}
          x={200}
          y={200}
          isHovered={false}
          isSelected={false}
          matchedCount={2}
          onSelect={vi.fn()}
          onHover={vi.fn()}
        />
      </svg>,
    );
    expect(screen.getByRole('button', { name: 'Berlin: 2 sites' })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows a "visible/total" badge when filters trim members', () => {
    renderWithProviders(
      <svg>
        <GeoMapCluster
          group={group}
          x={200}
          y={200}
          isHovered={false}
          isSelected={false}
          matchedCount={1}
          onSelect={vi.fn()}
          onHover={vi.fn()}
        />
      </svg>,
    );
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('fires onSelect with the cluster key on click', () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <svg>
        <GeoMapCluster
          group={group}
          x={200}
          y={200}
          isHovered={false}
          isSelected={false}
          matchedCount={2}
          onSelect={onSelect}
          onHover={vi.fn()}
        />
      </svg>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Berlin: 2 sites' }));
    expect(onSelect).toHaveBeenCalledWith(clusterKeyOf(group));
  });

  it('splits its ring into one arc per member certificate state', () => {
    const { container } = renderWithProviders(
      <svg>
        <GeoMapCluster
          group={group}
          x={200}
          y={200}
          isHovered={false}
          isSelected={false}
          matchedCount={2}
          onSelect={vi.fn()}
          onHover={vi.fn()}
        />
      </svg>,
    );
    const arcs = Array.from(container.querySelectorAll('circle[stroke-dasharray]'));
    expect(arcs.map((c) => (c as SVGElement).style.stroke)).toEqual([
      'var(--tone-success-fg)',
      'var(--tone-danger-fg)',
    ]);
  });

  it('reports the expanded state while its members are fanned out', () => {
    renderWithProviders(
      <svg>
        <GeoMapCluster
          group={group}
          x={200}
          y={200}
          isHovered={false}
          isSelected
          expanded
          matchedCount={2}
          onSelect={vi.fn()}
          onHover={vi.fn()}
        />
      </svg>,
    );
    expect(screen.getByRole('button', { name: 'Berlin: 2 sites' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
