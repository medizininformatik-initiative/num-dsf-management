/**
 * EndpointsCard.test.tsx — renders endpoint rows (name, identifier, IPs, row target) with
 * labelled FHIR/BPE flags and their legend, the load-error state with retry, opens the
 * endpoint-add and endpoint-edit modals, and deletes an endpoint only after a confirmation
 * that names the memberships deleted with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useModals } from '../../../hooks/useModals';

interface Row {
  identifier: string;
  name?: string;
  address: string;
  ipAddresses: { id: string; ip: string; isFhir: boolean; isBpe: boolean }[];
}

const deleteEndpoint = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
let rows: Row[] | undefined = [];
let isError = false;
let memberships: { id: string; endpoint_id: string }[] = [];

vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({ data: rows, isLoading: false, isError, refetch }),
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

const fhir: Row = {
  identifier: 'fhir.ukm.de',
  name: 'UKM FHIR',
  address: 'https://fhir.ukm.de/fhir',
  ipAddresses: [{ id: 'ip1', ip: '10.0.0.1', isFhir: true, isBpe: false }],
};

beforeEach(() => {
  rows = [fhir];
  isError = false;
  memberships = [];
  refetch.mockReset();
  deleteEndpoint.mockReset().mockResolvedValue(undefined);
  useModals.getState().closeModal();
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
    await userEvent.click(screen.getByText('Add'));
    expect(useModals.getState().open).toBe('endpoint-add');
  });

  it('tags each row with its identifier for foreign keys and staggers the rows in', () => {
    rows = [fhir, { ...fhir, identifier: 'bpe.ukm.de', name: undefined, ipAddresses: [] }];
    const { container } = renderWithProviders(<EndpointsCard instanceId="i1" />);
    const rowEls = Array.from(container.querySelectorAll<HTMLElement>('[data-entity-row]'));
    expect(rowEls.map((el) => el.dataset.entityRow)).toEqual([
      'endpoints:fhir.ukm.de',
      'endpoints:bpe.ukm.de',
    ]);
    expect(rowEls[1]).toHaveClass('animate-list-item-in');
    expect(rowEls[1].style.getPropertyValue('--stagger-index')).toBe('1');
  });

  it('spells out the F/B flags for screen readers and explains them in a legend', () => {
    rows = [
      {
        ...fhir,
        ipAddresses: [
          { id: 'ip1', ip: '10.0.0.1', isFhir: true, isBpe: false },
          { id: 'ip2', ip: '10.0.0.2', isFhir: false, isBpe: true },
        ],
      },
    ];
    renderWithProviders(<EndpointsCard instanceId="i1" />);
    const ips = within(screen.getByRole('list', { name: 'IP addresses' })).getAllByRole('listitem');
    expect(ips[0]).toHaveTextContent('10.0.0.1FFHIR server');
    expect(within(ips[0]).getByText('FHIR server')).toHaveClass('sr-only');
    expect(ips[1]).toHaveTextContent('10.0.0.2BBPE (process engine)');
    // The visible legend names both flags.
    const legend = screen.getByText('BPE (process engine)', { selector: 'p > span' });
    expect(legend.parentElement).toHaveTextContent('FFHIR server');
  });

  it('shows no flag legend when no IP carries a flag', () => {
    rows = [{ ...fhir, ipAddresses: [{ id: 'ip1', ip: '10.0.0.1', isFhir: false, isBpe: false }] }];
    renderWithProviders(<EndpointsCard instanceId="i1" />);
    expect(screen.queryByText('FHIR server')).not.toBeInTheDocument();
  });

  it('opens the editor of the endpoint whose named edit button was pressed', async () => {
    renderWithProviders(<EndpointsCard instanceId="i1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit endpoint UKM FHIR' }));
    expect(useModals.getState().open).toBe('endpoint-edit');
    expect(useModals.getState().editId).toBe('fhir.ukm.de');
  });

  it('shows a load error with a retry instead of the empty state', async () => {
    rows = undefined;
    isError = true;
    renderWithProviders(<EndpointsCard instanceId="i1" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/No endpoints yet/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
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
