import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';

const mutateAsync = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useOrganization', () => ({
  useUpdateOrganization: () => ({ mutate: vi.fn(), mutateAsync, isPending: false }),
}));
vi.mock('../../../lib/authMode', () => ({ needsTotpStepUp: () => true }));

import { OrganizationModal } from '../OrganizationModal';

describe('OrganizationModal', () => {
  it('renders nothing when closed', () => {
    const { container } = renderWithProviders(
      <OrganizationModal open={false} onClose={() => {}} instanceId="i1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the title and the name field when open', () => {
    renderWithProviders(<OrganizationModal open onClose={() => {}} instanceId="i1" />);
    expect(screen.getByRole('heading', { name: /edit organization/i })).toBeInTheDocument();
    expect(screen.getByText(/^Name$/)).toBeInTheDocument();
  });

  it('shows a validation error when submitting empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrganizationModal open onClose={() => {}} instanceId="i1" />);
    await user.click(screen.getByRole('button', { name: /save organization/i }));
    // identifier/name/email are required by organizationSchema — inline errors surface.
    expect((await screen.findAllByText(/required|valid|invalid/i)).length).toBeGreaterThan(0);
  });

  it('exposes "active" as a labelled, described switch', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <OrganizationModal
        open
        onClose={() => {}}
        instanceId="i1"
        defaultValues={{ identifier: 'klinik.example.de', name: 'Klinik', email: 'a@b.de' }}
      />,
    );
    const toggle = screen.getByRole('switch', { name: 'Active' });
    expect(toggle).toHaveAccessibleDescription(/active in the network/i);
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
  });

  it('locks the identifier of an existing organization and says why', () => {
    renderWithProviders(
      <OrganizationModal
        open
        onClose={() => {}}
        instanceId="i1"
        defaultValues={{ identifier: 'klinik.example.de', name: 'Klinik', email: 'a@b.de' }}
      />,
    );
    const identifier = screen.getByRole('textbox', { name: /identifier \(fqdn\)/i });
    expect(identifier).toBeDisabled();
    expect(identifier).toHaveAccessibleDescription(/other allowlist tools reference/i);
    expect(screen.getByText(/immutable in federated mode/i)).toBeInTheDocument();
  });
});

describe('OrganizationModal step-up code', () => {
  it('omits totpCode when the thumbprint is unchanged', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({});
    renderWithProviders(
      <OrganizationModal
        open
        onClose={() => {}}
        instanceId="i1"
        defaultValues={{ identifier: 'klinik.example.de', name: 'Klinik', email: 'a@b.de' }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /save organization/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0][0]).not.toHaveProperty('totpCode');
  });
});
