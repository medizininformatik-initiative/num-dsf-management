/**
 * MembershipsCard.test.tsx — renders membership rows (parent org, roles, row target) with each
 * membership's own endpoint as a foreign key to that endpoint's row, the load-error state with
 * retry, opens the membership-add modal, and deletes a membership only after a confirmation
 * naming the parent organization and roles.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useModals } from '../../../hooks/useModals';
import { useCanvasStore } from '../../../stores/canvas.store';

interface Row {
  id: string;
  parent_organization: string;
  roles: string[];
  endpoint_id: string;
}

const deleteMembership = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
let rows: Row[] | undefined = [];
let isError = false;

vi.mock('../../../hooks/useMemberships', () => ({
  useMemberships: () => ({ data: rows, isLoading: false, isError, refetch }),
  useDeleteMembership: () => ({ mutate: vi.fn(), mutateAsync: deleteMembership }),
}));
vi.mock('../../../hooks/useOrganization', () => ({
  useOrganization: () => ({ data: { identifier: 'ukm.de' }, isLoading: false }),
}));
vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({ data: [{ identifier: 'fhir.ukm.de' }], isLoading: false }),
}));

import { MembershipsCard } from '../MembershipsCard';

const dic: Row = {
  id: 'm1',
  parent_organization: 'num.de',
  roles: ['DIC'],
  endpoint_id: 'fhir.ukm.de',
};

beforeEach(() => {
  rows = [dic];
  isError = false;
  refetch.mockReset();
  deleteMembership.mockReset().mockResolvedValue(undefined);
  useCanvasStore.setState({ highlightedEntity: null, highlightedKey: null });
});

describe('MembershipsCard', () => {
  it('renders a membership row with parent organization and role', () => {
    renderWithProviders(<MembershipsCard instanceId="i1" />);
    expect(screen.getByText('num.de')).toBeInTheDocument();
    expect(screen.getByText(/DIC/)).toBeInTheDocument();
  });

  it('opens the membership-add modal when Add is clicked', async () => {
    renderWithProviders(<MembershipsCard instanceId="i1" />);
    await userEvent.click(screen.getByText('Add'));
    expect(useModals.getState().open).toBe('membership-add');
  });

  it("links each membership to its own endpoint's row", async () => {
    rows = [dic, { ...dic, id: 'm2', parent_organization: 'mii.de', endpoint_id: 'bpe.ukm.de' }];
    const { container } = renderWithProviders(<MembershipsCard instanceId="i1" />);
    const rowEls = Array.from(container.querySelectorAll<HTMLElement>('[data-entity-row]'));
    expect(rowEls.map((el) => el.dataset.entityRow)).toEqual(['memberships:m1', 'memberships:m2']);
    expect(within(rowEls[0]).getByText('fhir.ukm.de')).toBeInTheDocument();
    expect(within(rowEls[1]).getByText('bpe.ukm.de')).toBeInTheDocument();

    await userEvent.click(within(rowEls[1]).getByText('bpe.ukm.de'));
    expect(useCanvasStore.getState().highlightedEntity).toBe('endpoints');
    expect(useCanvasStore.getState().highlightedKey).toBe('bpe.ukm.de');
  });

  it('no longer shows a card-level endpoint taken from the first endpoint', () => {
    rows = [];
    renderWithProviders(<MembershipsCard instanceId="i1" />);
    expect(screen.queryByText('Endpoint')).not.toBeInTheDocument();
    expect(screen.queryByText('fhir.ukm.de')).not.toBeInTheDocument();
  });

  it('shows a load error with a retry instead of the empty state', async () => {
    rows = undefined;
    isError = true;
    renderWithProviders(<MembershipsCard instanceId="i1" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/No memberships yet/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('deletes a membership only after the confirmation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MembershipsCard instanceId="i1" />);

    await user.click(screen.getByRole('button', { name: 'Delete membership in num.de' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete membership?' });
    expect(dialog).toHaveAccessibleDescription(/The membership in num\.de \(DIC\) will be removed/);
    expect(deleteMembership).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteMembership).toHaveBeenCalledWith('m1'));
  });
});
