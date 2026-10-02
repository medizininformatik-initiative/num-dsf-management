/**
 * EndpointsCard.test.tsx — renders an endpoint row (name, identifier, IP), opens
 * the endpoint-add modal, and deletes an endpoint only after a confirmation that
 * names the memberships deleted with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useModals } from '../../../hooks/useModals';

const deleteEndpoint = vi.hoisted(() => vi.fn());
let memberships: { id: string; endpoint_id: string }[] = [];

vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({
    data: [
      {
        identifier: 'fhir.ukm.de',
        name: 'UKM FHIR',
        address: 'https://fhir.ukm.de/fhir',
        ipAddresses: [{ id: 'ip1', ip: '10.0.0.1', isFhir: true, isBpe: false }],
      },
    ],
    isLoading: false,
  }),
  useDeleteEndpoint: () => ({ mutate: vi.fn(), mutateAsync: deleteEndpoint }),
}));
vi.mock('../../../hooks/useOrganization', () => ({
  useOrganization: () => ({ data: { identifier: 'ukm.de' }, isLoading: false }),
}));
vi.mock('../../../hooks/useMemberships', () => ({
  useMemberships: () => ({ data: memberships, isLoading: false }),
}));
vi.mock('../../../hooks/useApproval', () => ({
  useApprovalHistory: () => ({ data: [] }),
}));

import { EndpointsCard } from '../EndpointsCard';

beforeEach(() => {
  memberships = [];
  deleteEndpoint.mockReset().mockResolvedValue(undefined);
});

describe('EndpointsCard', () => {
  it('renders an endpoint row with name, identifier and IP', () => {
    renderWithProviders(<EndpointsCard instanceId="i1" />);
    expect(screen.getByText('UKM FHIR')).toBeInTheDocument();
    expect(screen.getByText('fhir.ukm.de')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
  });

  it('opens the endpoint-add modal when Add is clicked', async () => {
    renderWithProviders(<EndpointsCard instanceId="i1" />);
    await userEvent.click(screen.getByText('+ Add'));
    expect(useModals.getState().open).toBe('endpoint-add');
  });
});

describe('EndpointsCard deletion', () => {
  it('names the memberships deleted with the endpoint and deletes once confirmed', async () => {
    const user = userEvent.setup();
    memberships = [
      { id: 'm1', endpoint_id: 'fhir.ukm.de' },
      { id: 'm2', endpoint_id: 'fhir.ukm.de' },
      { id: 'm3', endpoint_id: 'bpe.ukm.de' },
    ];
    renderWithProviders(<EndpointsCard instanceId="i1" />);

    await user.click(screen.getByRole('button', { name: /delete endpoint/i }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete endpoint?' });
    expect(dialog).toHaveAccessibleDescription(/UKM FHIR \(fhir\.ukm\.de\) will be removed/);
    expect(
      within(dialog).getByText(/The 2 memberships bound to this endpoint are deleted with it/),
    ).toBeInTheDocument();
    expect(deleteEndpoint).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteEndpoint).toHaveBeenCalledWith('fhir.ukm.de'));
  });

  it('explains the network-wide effect when no membership is bound', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EndpointsCard instanceId="i1" />);

    await user.click(screen.getByRole('button', { name: /delete endpoint/i }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(/the endpoint disappears for every site in the network/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(deleteEndpoint).not.toHaveBeenCalled();
  });
});
