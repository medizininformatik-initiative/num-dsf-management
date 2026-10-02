/**
 * OrganizationCard.test.tsx — the organization summary: fields and status
 * pills, and the data states (skeleton while loading, retry on a failed
 * request, the "Set up" invitation only for a real empty result).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useModals } from '../../../hooks/useModals';

vi.mock('../../../hooks/useOrganization', () => ({
  useOrganization: vi.fn(),
  useUpdateOrganization: vi.fn(),
}));
vi.mock('../../../hooks/useContacts', () => ({
  useContacts: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../../hooks/useApproval', () => ({
  useApprovalStatus: () => ({ data: { status: 'PENDING' } }),
}));

import { useOrganization } from '../../../hooks/useOrganization';
import { OrganizationCard } from '../OrganizationCard';

const ORG = {
  identifier: 'ukm.de',
  name: 'University Hospital Muenster',
  email: 'org@ukm.de',
  // MySQL BOOLEAN arrives as 0/1.
  active: 1,
  address_line: 'Albert-Schweitzer-Campus 1',
  postal_code: '48149',
  city: 'Muenster',
  country_code: 'DE',
  client_cert_thumbprint: null,
};

const refetch = vi.fn();

function mockOrg(state: { data?: unknown; isLoading?: boolean; isError?: boolean }) {
  vi.mocked(useOrganization).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch,
    ...state,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  useModals.getState().closeModal();
  mockOrg({ data: ORG });
});

describe('OrganizationCard', () => {
  it('renders the organization identifier and name', () => {
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    expect(screen.getByText('ukm.de')).toBeInTheDocument();
    expect(screen.getByText('University Hospital Muenster')).toBeInTheDocument();
  });

  it('opens the org-edit modal from the Edit Button named after the card', async () => {
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Organization' }));
    expect(useModals.getState().open).toBe('org-edit');
  });

  it('shows status and approval as pills in the shared tones', () => {
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    expect(screen.getByText('active').closest('.pill')).toHaveClass('text-success-fg');
    expect(screen.getByText('Pending').closest('.pill')).toHaveClass('text-warning-fg');
  });

  it('marks an inactive organization with the danger tone', () => {
    mockOrg({ data: { ...ORG, active: 0 } });
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    expect(screen.getByText('inactive').closest('.pill')).toHaveClass('text-danger-fg');
  });

  it('has no permanent double-click hint', () => {
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    expect(screen.queryByText(/double-click/i)).not.toBeInTheDocument();
  });
});

describe('OrganizationCard data states', () => {
  it('shows a skeleton while loading, not the empty state', () => {
    mockOrg({ isLoading: true });
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    expect(screen.getByRole('region', { name: 'Organization' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByText(/No organization yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set up/ })).not.toBeInTheDocument();
  });

  it('offers a retry when the request fails, never the set-up invitation', async () => {
    mockOrg({ isError: true });
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load this data.');
    expect(screen.queryByText(/No organization yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set up/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('invites setting up only when no organization exists', async () => {
    mockOrg({ data: null });
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    expect(screen.getByText(/No organization yet/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set up Organization' }));
    expect(useModals.getState().open).toBe('org-edit');
  });

  it('translates the set-up action', () => {
    mockOrg({ data: null });
    renderWithProviders(<OrganizationCard instanceId="i1" />, { lang: 'de' });
    expect(screen.getByRole('button', { name: 'Einrichten Organisation' })).toBeInTheDocument();
    expect(screen.getByText('Klicken Sie auf „Einrichten“, um zu beginnen.')).toBeInTheDocument();
  });
});
