/**
 * FormModals.dirty.test.tsx — every form modal hands React Hook Form's
 * isDirty to Modal: untouched, Escape closes at once; after an edit, Escape
 * first asks to discard the changes ("Keep editing" keeps the dialog open).
 * Data and mutation hooks are mocked; no network is touched.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';

const idle = vi.hoisted(() => () => ({ mutateAsync: vi.fn(), isPending: false }));

vi.mock('../../../hooks/useContacts', () => ({
  useContacts: () => ({ data: [] }),
  useCreateContact: idle,
  useUpdateContact: idle,
}));
vi.mock('../../../hooks/useMemberships', () => ({
  useMemberships: () => ({ data: [] }),
  useCreateMembership: idle,
  useUpdateMembership: idle,
}));
vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({ data: [] }),
  useCreateEndpoint: idle,
  useUpdateEndpoint: idle,
}));
vi.mock('../../../hooks/useOrganization', () => ({ useUpdateOrganization: idle }));
vi.mock('../../../hooks/useMarketplace', () => ({
  useAddMarketplace: idle,
  useUpdateMarketplaceMeta: idle,
}));

import { ContactModal } from '../ContactModal';
import { MembershipModal } from '../MembershipModal';
import { EndpointModal } from '../EndpointModal';
import { OrganizationModal } from '../OrganizationModal';
import { MarketplaceAddModal } from '../MarketplaceAddModal';
import { MarketplaceEditStatusModal } from '../MarketplaceEditStatusModal';

type Case = [name: string, render: (onClose: () => void) => ReactElement, edit: () => void];

function typeInto(name: RegExp, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
}

const cases: Case[] = [
  [
    'ContactModal',
    (onClose) => <ContactModal open onClose={onClose} instanceId="i1" />,
    () => typeInto(/^name$/i, 'Dr. Example'),
  ],
  [
    'MembershipModal',
    (onClose) => <MembershipModal open onClose={onClose} instanceId="i1" />,
    () => fireEvent.click(screen.getByRole('checkbox', { name: /DIC/ })),
  ],
  [
    'EndpointModal',
    (onClose) => <EndpointModal open onClose={onClose} instanceId="i1" />,
    () => typeInto(/^name$/i, 'Prod'),
  ],
  [
    'OrganizationModal',
    (onClose) => (
      <OrganizationModal
        open
        onClose={onClose}
        instanceId="i1"
        defaultValues={{ identifier: 'klinik.example.de', name: 'Klinik', email: 'a@b.de' }}
      />
    ),
    () => typeInto(/^name/i, 'Klinik Eins'),
  ],
  [
    'MarketplaceAddModal',
    (onClose) => <MarketplaceAddModal open onClose={onClose} />,
    () => typeInto(/github url/i, 'https://github.com/o/r'),
  ],
  [
    'MarketplaceEditStatusModal',
    (onClose) => (
      <MarketplaceEditStatusModal open onClose={onClose} entryId="e1" currentStatus="APPROVED" />
    ),
    () => typeInto(/superseded by/i, 'owner-repo'),
  ],
];

describe.each(cases)('%s discard protection', (_name, renderModal, edit) => {
  it('closes at once when nothing was changed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(renderModal(onClose));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding an edit', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(renderModal(onClose));
    edit();
    await user.keyboard('{Escape}');
    const confirm = await screen.findByRole('alertdialog', { name: /discard changes/i });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    await waitFor(() => expect(confirm).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});
