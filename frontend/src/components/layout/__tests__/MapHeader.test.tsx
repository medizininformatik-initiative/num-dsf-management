/**
 * MapHeader.test.tsx — title and role badge. The badge follows the network
 * map's meta.isAdmin (the signal that picks the map view), falls back to
 * useMe while the map loads, and stays hidden while the role is unknown
 * instead of defaulting to "Member".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';

const state = vi.hoisted(() => ({
  me: undefined as { email: string; isAdmin: boolean } | undefined,
  map: undefined as { organizations: unknown[]; isAdmin: boolean } | undefined,
}));

vi.mock('../../../hooks/useMe', () => ({
  useMe: () => ({ data: state.me, isLoading: state.me === undefined }),
}));
vi.mock('../../../hooks/useNetworkMap', () => ({
  useNetworkMap: () => ({ data: state.map, isLoading: state.map === undefined }),
}));

import { MapHeader } from '../../map/MapHeader';

beforeEach(() => {
  state.me = undefined;
  state.map = undefined;
});

describe('MapHeader', () => {
  it('renders the Federation map title and the admin role badge (no emoji)', () => {
    state.me = { email: 'admin@imi-test.example.de', isAdmin: true };
    state.map = { organizations: [], isAdmin: true };
    renderWithProviders(<MapHeader />);
    expect(screen.getByRole('heading', { name: /federation map/i })).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.queryByText('Member')).not.toBeInTheDocument();
  });

  it('shows the admin badge when /auth/me failed but the map says admin', () => {
    state.me = undefined;
    state.map = { organizations: [], isAdmin: true };
    renderWithProviders(<MapHeader />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.queryByText('Member')).not.toBeInTheDocument();
  });

  it('trusts the map response over a stale member entry in the me cache', () => {
    state.me = { email: 'admin@imi-test.example.de', isAdmin: false };
    state.map = { organizations: [], isAdmin: true };
    renderWithProviders(<MapHeader />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('falls back to useMe while the map is still loading', () => {
    state.me = { email: 'admin@imi-test.example.de', isAdmin: true };
    renderWithProviders(<MapHeader />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('renders no role badge while the role is unknown', () => {
    renderWithProviders(<MapHeader />);
    expect(screen.getByRole('heading', { name: /federation map/i })).toBeInTheDocument();
    expect(screen.queryByText('Member')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('shows the member badge for members', () => {
    state.me = { email: 'site@klinik-eins.example.de', isAdmin: false };
    state.map = { organizations: [], isAdmin: false };
    renderWithProviders(<MapHeader />);
    expect(screen.getByText('Member')).toBeInTheDocument();
  });
});
