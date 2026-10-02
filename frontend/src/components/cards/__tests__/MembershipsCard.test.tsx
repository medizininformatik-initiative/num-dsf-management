/**
 * MembershipsCard.test.tsx — renders a membership row (parent org + role), opens
 * the membership-add modal, and deletes a membership only after a confirmation
 * naming the parent organization and roles.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useModals } from '../../../hooks/useModals';

const deleteMembership = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/useMemberships', () => ({
  useMemberships: () => ({
    data: [{ id: 'm1', parent_organization: 'num.de', roles: ['DIC'], endpoint_id: 'ep1' }],
    isLoading: false,
  }),
  useDeleteMembership: () => ({ mutate: vi.fn(), mutateAsync: deleteMembership }),
}));
vi.mock('../../../hooks/useOrganization', () => ({
  useOrganization: () => ({ data: { identifier: 'ukm.de' }, isLoading: false }),
}));
vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({ data: [{ identifier: 'fhir.ukm.de' }], isLoading: false }),
}));

import { MembershipsCard } from '../MembershipsCard';

beforeEach(() => {
  deleteMembership.mockReset().mockResolvedValue(undefined);
});

describe('MembershipsCard', () => {
  it('renders a membership row with parent organization and role', () => {
    renderWithProviders(<MembershipsCard instanceId="i1" />);
    expect(screen.getByText('num.de')).toBeInTheDocument();
    expect(screen.getByText(/DIC/)).toBeInTheDocument();
  });

  it('opens the membership-add modal when Add is clicked', async () => {
    renderWithProviders(<MembershipsCard instanceId="i1" />);
    await userEvent.click(screen.getByText('+ Add'));
    expect(useModals.getState().open).toBe('membership-add');
  });

  it('deletes a membership only after the confirmation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MembershipsCard instanceId="i1" />);

    await user.click(screen.getByRole('button', { name: /delete membership/i }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete membership?' });
    expect(dialog).toHaveAccessibleDescription(/The membership in num\.de \(DIC\) will be removed/);
    expect(deleteMembership).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteMembership).toHaveBeenCalledWith('m1'));
  });
});
