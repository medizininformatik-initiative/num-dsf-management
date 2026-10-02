/**
 * ContactsCard.test.tsx — renders a contact row (name + type badge), opens the
 * contact-add modal, and deletes a contact only after the confirmation dialog
 * (Cancel keeps it; the last contact gets its own warning).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useModals } from '../../../hooks/useModals';

interface Row {
  id: string;
  name?: string;
  email: string;
  types: string[];
  email_validated: boolean;
}

const deleteContact = vi.hoisted(() => vi.fn());
let rows: Row[] = [];

vi.mock('../../../hooks/useContacts', () => ({
  useContacts: () => ({ data: rows, isLoading: false }),
  useDeleteContact: () => ({ mutate: vi.fn(), mutateAsync: deleteContact }),
}));
vi.mock('../../../hooks/useOrganization', () => ({
  useOrganization: () => ({ data: { identifier: 'ukm.de' }, isLoading: false }),
}));

import { ContactsCard } from '../ContactsCard';

const medic: Row = {
  id: 'c1',
  name: 'Dr. Test',
  email: 'd@ukm.de',
  types: ['MEDIC'],
  email_validated: true,
};

beforeEach(() => {
  rows = [medic];
  deleteContact.mockReset().mockResolvedValue(undefined);
});

describe('ContactsCard', () => {
  it('renders a contact row with its type badge', () => {
    renderWithProviders(<ContactsCard instanceId="i1" />);
    expect(screen.getByText(/Dr\. Test/)).toBeInTheDocument();
    expect(screen.getByText('MEDIC')).toBeInTheDocument();
  });

  it('opens the contact-add modal when Add is clicked', async () => {
    renderWithProviders(<ContactsCard instanceId="i1" />);
    await userEvent.click(screen.getByText('+ Add'));
    expect(useModals.getState().open).toBe('contact-add');
  });
});

describe('ContactsCard deletion', () => {
  it('asks before deleting and deletes the contact once confirmed', async () => {
    const user = userEvent.setup();
    rows = [medic, { ...medic, id: 'c2', name: 'Other', email: 'o@ukm.de' }];
    renderWithProviders(<ContactsCard instanceId="i1" />);

    await user.click(screen.getAllByRole('button', { name: /delete contact/i })[0]);
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete contact?' });
    expect(dialog).toHaveAccessibleDescription(/Dr\. Test will be removed/);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(deleteContact).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteContact).toHaveBeenCalledWith('c1'));
  });

  it('keeps the contact when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactsCard instanceId="i1" />);

    await user.click(screen.getByRole('button', { name: /delete contact/i }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(deleteContact).not.toHaveBeenCalled();
  });

  it('warns when the last contact would be deleted', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactsCard instanceId="i1" />);

    await user.click(screen.getByRole('button', { name: /delete contact/i }));
    expect(
      await screen.findByText(/This is the last contact of your organization/),
    ).toBeInTheDocument();
  });

  it('tells that security and DSF admin contacts lose the expiry reminders', async () => {
    const user = userEvent.setup();
    rows = [medic, { ...medic, id: 'c2', name: 'Sec', types: ['SECURITY'] }];
    renderWithProviders(<ContactsCard instanceId="i1" />);

    await user.click(screen.getAllByRole('button', { name: /delete contact/i })[1]);
    expect(
      await screen.findByText('This person no longer receives certificate expiry reminders.'),
    ).toBeInTheDocument();
  });
});
