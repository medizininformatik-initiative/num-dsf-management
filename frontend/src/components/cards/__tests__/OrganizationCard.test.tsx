/**
 * OrganizationCard.test.tsx — the organization summary: fields and status
 * pills, the data states (skeleton while loading, retry on a failed request,
 * the "Set up" invitation only for a real empty result) and keyboard inline
 * editing of name and email (pencil Buttons, Enter saves, Escape cancels,
 * schema validation with an inline error, pending state, no double submit).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { useOrganization, useUpdateOrganization } from '../../../hooks/useOrganization';
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

const mutateAsync = vi.fn();
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
  mutateAsync.mockResolvedValue({});
  vi.mocked(useUpdateOrganization).mockReturnValue({ mutateAsync } as never);
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

describe('OrganizationCard inline editing', () => {
  it('offers a keyboard-reachable pencil Button per editable field', () => {
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    expect(screen.getByRole('button', { name: 'Edit Name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Email' })).toBeInTheDocument();
  });

  it('saves with Enter and returns focus to the pencil Button', async () => {
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Name' }));
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveFocus();
    await userEvent.clear(input);
    await userEvent.type(input, 'UKM{Enter}');

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({
      identifier: 'ukm.de',
      name: 'UKM',
      email: 'org@ukm.de',
      active: true,
      addressLine: 'Albert-Schweitzer-Campus 1',
      postalCode: '48149',
      city: 'Muenster',
      countryCode: 'DE',
      clientCertThumbprint: '',
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Name' })).toHaveFocus());
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
    expect(screen.getByText('UKM')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Updated.');
  });

  it('saves from the check Button too', async () => {
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Email' }));
    const input = screen.getByRole('textbox', { name: 'Email' });
    await userEvent.clear(input);
    await userEvent.type(input, 'it@ukm.de');
    await userEvent.click(screen.getByRole('button', { name: 'Save Email' }));
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ email: 'it@ukm.de' }));
  });

  it('cancels with Escape without saving', async () => {
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Name' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), ' changed{Escape}');
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('University Hospital Muenster')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Name' })).toHaveFocus();
  });

  it('validates with the organization schema and shows the error inline', async () => {
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Name' }));
    const input = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(input);
    await userEvent.keyboard('{Enter}');

    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('Name is required');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', error.id);
    expect(input).toHaveFocus();
    expect(mutateAsync).not.toHaveBeenCalled();

    // Once corrected, the message goes away as the user types.
    await userEvent.type(input, 'U');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects an invalid email', async () => {
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Email' }));
    const input = screen.getByRole('textbox', { name: 'Email' });
    await userEvent.clear(input);
    await userEvent.type(input, 'not-an-email{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Must be a valid email address');
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('closes without a request when the value is unchanged', async () => {
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Name' }));
    await userEvent.keyboard('{Enter}');
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
  });

  it('shows a pending state and ignores a second submit while saving', async () => {
    let finish: (value: unknown) => void = () => {};
    mutateAsync.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Name' }));
    const input = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'UKM{Enter}');

    expect(input).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Save Name' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel editing Name' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');

    await userEvent.keyboard('{Enter}');
    fireEvent.blur(input);
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => finish({}));
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
  });

  it('keeps the editor open with the typed value after a failed save', async () => {
    mutateAsync.mockRejectedValue(new Error('500'));
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Name' }));
    const input = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'UKM{Enter}');

    expect(toast.error).toHaveBeenCalledWith('Failed to update.');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('UKM');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('closes an unchanged editor when focus leaves it', async () => {
    renderWithProviders(<OrganizationCard instanceId="i1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Name' }));
    fireEvent.blur(screen.getByRole('textbox', { name: 'Name' }));
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
  });
});
