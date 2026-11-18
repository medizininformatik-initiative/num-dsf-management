import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';

const createMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('../../../hooks/useMemberships', () => ({
  useMemberships: () => ({
    data: [
      {
        id: 'm1',
        parent_organization: 'eyematics.org',
        endpoint_id: 'ep1.example.de',
        roles: ['DIC'],
      },
    ],
    isLoading: false,
  }),
  useCreateMembership: () => ({ mutate: vi.fn(), mutateAsync: createMock, isPending: false }),
  useUpdateMembership: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({
    data: [
      { identifier: 'ep1.example.de', name: 'EP One', address: 'https://ep1.example.de/fhir' },
      { identifier: 'ep2.example.de', name: 'EP Two', address: 'https://ep2.example.de/fhir' },
    ],
    isLoading: false,
  }),
}));
const parentsState = vi.hoisted(() => ({
  value: {
    data: [
      { identifier: 'eyematics.org', name: 'Eyematics', known: true, usedBy: 0 },
      { identifier: 'hackathon-hub.example.de', name: 'Hackathon Hub', known: false, usedBy: 3 },
    ] as unknown[] | undefined,
    isLoading: false,
    isError: false,
  },
}));
vi.mock('../../../hooks/useParentOrganizations', () => ({
  useParentOrganizations: () => parentsState.value,
}));

import { MembershipModal } from '../MembershipModal';

describe('MembershipModal', () => {
  it('renders nothing when closed', () => {
    const { container } = renderWithProviders(
      <MembershipModal open={false} onClose={() => {}} instanceId="i1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the title and parent-organization field when open', () => {
    renderWithProviders(<MembershipModal open onClose={() => {}} instanceId="i1" />);
    expect(screen.getByRole('heading', { name: /add new membership/i })).toBeInTheDocument();
    expect(screen.getAllByText(/parent organization/i).length).toBeGreaterThan(0);
  });

  it('shows a validation error when submitting empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MembershipModal open onClose={() => {}} instanceId="i1" />);
    await user.click(screen.getByRole('button', { name: /add membership/i }));
    expect(await screen.findByText(/parent organization is required/i)).toBeInTheDocument();
  });

  it('presents the roles as a labelled group with translated descriptions', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MembershipModal open onClose={() => {}} instanceId="i1" />, {
      lang: 'de',
    });
    const group = screen.getByRole('group', { name: /^Rollen/ });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(4);
    expect(screen.getByText(/Datenintegrationszentrum/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /mitgliedschaft hinzufügen/i }));
    expect(group).toHaveAccessibleDescription(/mindestens eine rolle/i);
  });

  describe('parent organization', () => {
    async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
      await user.selectOptions(screen.getByLabelText(/^endpoint/i), 'ep1.example.de');
      await user.click(screen.getByRole('checkbox', { name: /DIC/ }));
      await user.click(screen.getByRole('button', { name: /add membership/i }));
    }

    it('offers parents from the endpoint grouped, with name and identifier', () => {
      renderWithProviders(<MembershipModal open onClose={() => {}} instanceId="i1" />);
      const select = screen.getByLabelText(/^parent organization/i);
      expect(within(select).getByRole('group', { name: 'Networks' })).toBeInTheDocument();
      expect(
        within(select).getByRole('group', { name: 'Used in the network' }),
      ).toBeInTheDocument();
      expect(
        within(select).getByRole('option', { name: 'Hackathon Hub (hackathon-hub.example.de)' }),
      ).toBeInTheDocument();
    });

    it('lets the user pick a parent that came from the endpoint', async () => {
      createMock.mockClear();
      const user = userEvent.setup();
      renderWithProviders(<MembershipModal open onClose={() => {}} instanceId="i1" />);
      await user.selectOptions(
        screen.getByLabelText(/^parent organization/i),
        'hackathon-hub.example.de',
      );
      await fillAndSubmit(user);
      await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
      expect(createMock.mock.calls[0][0]).toMatchObject({
        parentOrganization: 'hackathon-hub.example.de',
      });
    });

    it('accepts a new identifier under "Other organization" and lower-cases it', async () => {
      createMock.mockClear();
      const user = userEvent.setup();
      renderWithProviders(<MembershipModal open onClose={() => {}} instanceId="i1" />);
      await user.selectOptions(screen.getByLabelText(/^parent organization/i), '__other__');
      await user.type(
        screen.getByLabelText(/identifier of the parent organization/i),
        'New.Hub.example.de',
      );
      await fillAndSubmit(user);
      await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
      expect(createMock.mock.calls[0][0]).toMatchObject({
        parentOrganization: 'new.hub.example.de',
      });
    });

    it('shows an inline error for an invalid custom identifier', async () => {
      createMock.mockClear();
      const user = userEvent.setup();
      renderWithProviders(<MembershipModal open onClose={() => {}} instanceId="i1" />);
      await user.selectOptions(screen.getByLabelText(/^parent organization/i), '__other__');
      await user.type(screen.getByLabelText(/identifier of the parent organization/i), 'not valid');
      await fillAndSubmit(user);
      expect(await screen.findByText(/enter a lower-case identifier/i)).toBeInTheDocument();
      expect(createMock).not.toHaveBeenCalled();
    });

    it('falls back to the known networks when the list cannot be loaded', () => {
      parentsState.value = { data: undefined, isLoading: false, isError: true };
      try {
        renderWithProviders(<MembershipModal open onClose={() => {}} instanceId="i1" />);
        const select = screen.getByLabelText(/^parent organization/i);
        expect(within(select).getByRole('option', { name: /dktk\.dkfz\.de/ })).toBeInTheDocument();
        expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
      } finally {
        parentsState.value = {
          data: [
            { identifier: 'eyematics.org', name: 'Eyematics', known: true, usedBy: 0 },
            {
              identifier: 'hackathon-hub.example.de',
              name: 'Hackathon Hub',
              known: false,
              usedBy: 3,
            },
          ],
          isLoading: false,
          isError: false,
        };
      }
    });
  });
});

describe('MembershipModal endpoint change warning', () => {
  const warning = /affects every site in the network/;
  const pickEndpoint = (user: ReturnType<typeof userEvent.setup>, label: RegExp) =>
    user.selectOptions(
      screen.getByRole('combobox', { name: /endpoint/i }),
      screen.getByRole('option', { name: label }),
    );

  it('appears in edit mode only once the endpoint differs from the initial one', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MembershipModal open onClose={() => {}} instanceId="i1" membershipId="m1" />,
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /endpoint/i })).toHaveValue('ep1.example.de'),
    );
    expect(screen.queryByText(warning)).not.toBeInTheDocument();

    await pickEndpoint(user, /EP Two/);
    expect(await screen.findByText(warning)).toBeInTheDocument();

    await pickEndpoint(user, /EP One/);
    await waitFor(() => expect(screen.queryByText(warning)).not.toBeInTheDocument());
  });

  it('stays hidden in create mode', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MembershipModal open onClose={() => {}} instanceId="i1" />);
    await pickEndpoint(user, /EP Two/);
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
  });
});
