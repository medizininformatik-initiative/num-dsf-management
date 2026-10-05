import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { MapOrgList } from '../MapOrgList';
import type { MapOrganization } from '../../../api/network.api';

function org(id: string, name: string, parent: string): MapOrganization {
  return {
    identifier: id,
    name,
    active: true,
    city: 'Berlin',
    country_code: 'DE',
    cert_status: 'VALID',
    endpoints: [],
    memberships: [{ parent_organization: parent, roles: ['DIC'] }],
  };
}

const orgs = [
  org('a.de', 'Alpha Klinik', 'mii-testverband.example.de'),
  org('b.de', 'Beta Klinik', 'mii-testverband.example.de'),
];

describe('MapOrgList', () => {
  it('renders the verbund group header and its members', () => {
    renderWithProviders(<MapOrgList organizations={orgs} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('mii-testverband.example.de')).toBeInTheDocument();
    expect(screen.getByText('Alpha Klinik')).toBeInTheDocument();
    expect(screen.getByText('Beta Klinik')).toBeInTheDocument();
  });

  it('calls onSelect with the org identifier when a member row is clicked', async () => {
    const onSelect = vi.fn();
    renderWithProviders(<MapOrgList organizations={orgs} selectedId={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByText('Alpha Klinik'));
    expect(onSelect).toHaveBeenCalledWith('a.de');
  });

  it('marks the selected row and reports row hover to the map', async () => {
    const onHover = vi.fn();
    renderWithProviders(
      <MapOrgList organizations={orgs} selectedId="b.de" onSelect={vi.fn()} onHover={onHover} />,
    );
    expect(screen.getByText('Beta Klinik').closest('button')).toHaveAttribute(
      'aria-current',
      'true',
    );
    await userEvent.hover(screen.getByText('Alpha Klinik'));
    expect(onHover).toHaveBeenLastCalledWith('a.de');
    await userEvent.unhover(screen.getByText('Alpha Klinik'));
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('collapses a group and closes from its header button', async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <MapOrgList organizations={orgs} selectedId={null} onSelect={vi.fn()} onClose={onClose} />,
    );
    const group = screen.getByRole('button', { name: /mii-testverband\.example\.de/ });
    expect(group).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(group);
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Alpha Klinik')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Hide organization list' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reopens a collapsed group when one of its organizations is selected', async () => {
    const { rerender } = renderWithProviders(
      <MapOrgList organizations={orgs} selectedId={null} onSelect={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /mii-testverband\.example\.de/ }));
    expect(screen.queryByText('Alpha Klinik')).toBeNull();
    rerender(<MapOrgList organizations={orgs} selectedId="a.de" onSelect={vi.fn()} />);
    expect(await screen.findByText('Alpha Klinik')).toBeInTheDocument();
  });

  it('shows an empty-state message when there are no organizations', () => {
    renderWithProviders(<MapOrgList organizations={[]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/No organizations match the current filter/i)).toBeInTheDocument();
  });
});
