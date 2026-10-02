/**
 * ContactsCard.test.tsx — renders contact rows (name, email, translated type badges,
 * verification state, row target), opens the editor from a row click or the named edit
 * button (not from nested controls), resends a verification email, shows the load-error
 * state with retry, opens the contact-add modal, and deletes a contact only after the
 * confirmation dialog (Cancel keeps it; the last contact gets its own warning).
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
const resendVerification = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
let rows: Row[] | undefined = [];
let isError = false;

vi.mock('../../../hooks/useContacts', () => ({
  useContacts: () => ({ data: rows, isLoading: false, isError, refetch }),
  useDeleteContact: () => ({ mutate: vi.fn(), mutateAsync: deleteContact }),
}));
vi.mock('../../../hooks/useOrganization', () => ({
  useOrganization: () => ({ data: { identifier: 'ukm.de' }, isLoading: false }),
}));
vi.mock('../../../api/entities.api', () => ({
  api: () => ({ resendVerification }),
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
  isError = false;
  refetch.mockReset();
  resendVerification.mockReset().mockResolvedValue(undefined);
  deleteContact.mockReset().mockResolvedValue(undefined);
  useModals.getState().closeModal();
});

describe('ContactsCard', () => {
  it('renders a contact row with its translated type badge', () => {
    renderWithProviders(<ContactsCard instanceId="i1" />);
    expect(screen.getByText(/Dr\. Test/)).toBeInTheDocument();
    expect(screen.getByText('d@ukm.de')).toBeInTheDocument();
    expect(screen.getByText('MeDIC contact')).toBeInTheDocument();
    expect(screen.queryByText('MEDIC')).not.toBeInTheDocument();
  });

  it('labels every contact type and keeps unknown types readable', () => {
    rows = [{ ...medic, types: ['DSF_ADMIN', 'SECURITY', 'OTHER'] }];
    renderWithProviders(<ContactsCard instanceId="i1" />, { lang: 'de' });
    expect(screen.getByText('DSF-Admin')).toBeInTheDocument();
    expect(screen.getByText('Sicherheit')).toBeInTheDocument();
    expect(screen.getByText('OTHER')).toBeInTheDocument();
  });

  it('opens the contact-add modal when Add is clicked', async () => {
    renderWithProviders(<ContactsCard instanceId="i1" />);
    await userEvent.click(screen.getByText('+ Add'));
    expect(useModals.getState().open).toBe('contact-add');
  });

  it('tags each row as a relation target', () => {
    const { container } = renderWithProviders(<ContactsCard instanceId="i1" />);
    expect(container.querySelector('[data-entity-row="contacts:c1"]')).not.toBeNull();
  });

  it('opens the editor when the row is clicked', async () => {
    renderWithProviders(<ContactsCard instanceId="i1" />);
    await userEvent.click(screen.getByText('d@ukm.de'));
    expect(useModals.getState().open).toBe('contact-edit');
    expect(useModals.getState().editId).toBe('c1');
  });

  it('opens the editor from the keyboard through the named edit button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactsCard instanceId="i1" />);
    screen.getByRole('button', { name: 'Edit contact Dr. Test' }).focus();
    await user.keyboard('{Enter}');
    expect(useModals.getState().open).toBe('contact-edit');
    expect(useModals.getState().editId).toBe('c1');
  });

  it('resends the verification email without opening the editor', async () => {
    rows = [{ ...medic, email_validated: false }];
    renderWithProviders(<ContactsCard instanceId="i1" />);
    expect(screen.getByText('Email not verified').closest('.pill')).toHaveClass('text-warning-fg');
    await userEvent.click(screen.getByRole('button', { name: 'Resend verification' }));
    await waitFor(() => expect(resendVerification).toHaveBeenCalledWith('c1'));
    expect(useModals.getState().open).toBeNull();
  });

  it('shows a load error with a retry instead of the empty state', async () => {
    rows = undefined;
    isError = true;
    renderWithProviders(<ContactsCard instanceId="i1" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/No contacts yet/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
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
