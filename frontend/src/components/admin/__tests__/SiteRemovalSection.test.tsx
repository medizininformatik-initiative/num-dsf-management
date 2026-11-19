/**
 * SiteRemovalSection.test.tsx — removing a site with two admins. The API and
 * sonner are mocked; the real i18n and StepUpConfirmDialog run in an OTP
 * session. Covers the confirm gating (requester, same e-mail domain, other
 * domain), the request form (site + reason needed, step-up code sent),
 * confirm with a code and the cancel button for the requester.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { InstanceRemoval } from '../../../api/adminInstanceRemovals.api';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  instances: vi.fn(),
  request: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('../../../api/adminInstanceRemovals.api', () => ({ adminInstanceRemovalsApi: api }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

vi.mock('../../../lib/authMode', () => ({
  isCertMode: () => false,
  needsTotpStepUp: () => true,
}));

import { SiteRemovalSection } from '../SiteRemovalSection';

const PENDING: InstanceRemoval = {
  id: 'r1',
  instanceId: 'i1',
  organizationId: 'clinic.example.de',
  reason: 'Site closed',
  requestedBy: 'a@uni-a.example.de',
  requestedAt: '2026-11-01T10:00:00Z',
  status: 'PENDING',
  decidedBy: null,
  decidedAt: null,
  versionNumber: null,
};

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  Object.values(toast).forEach((m) => m.mockReset());
  api.list.mockResolvedValue([PENDING]);
  api.instances.mockResolvedValue([
    {
      id: 'i2',
      label: 'other',
      user_email: 'o@x.de',
      org_identifier: 'other.example.de',
      org_name: 'Other',
      removed_at: null,
    },
  ]);
});

describe('SiteRemovalSection', () => {
  it('lets only an admin of another e-mail domain confirm', async () => {
    const own = renderWithProviders(<SiteRemovalSection meEmail="a@uni-a.example.de" />);
    const btn = await screen.findByRole('button', { name: 'Confirm removal' });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/You requested this removal/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeInTheDocument();
    own.unmount();

    const sameDomain = renderWithProviders(<SiteRemovalSection meEmail="a2@uni-a.example.de" />);
    expect(await screen.findByRole('button', { name: 'Confirm removal' })).toBeDisabled();
    expect(screen.getByText(/must belong to a different e-mail domain/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull();
    sameDomain.unmount();

    renderWithProviders(<SiteRemovalSection meEmail="b@uni-b.example.de" />);
    expect(await screen.findByRole('button', { name: 'Confirm removal' })).toBeEnabled();
  });

  it('confirms with the step-up code', async () => {
    api.confirm.mockResolvedValue({ removal: PENDING, versionNumber: 7, published: true });
    renderWithProviders(<SiteRemovalSection meEmail="b@uni-b.example.de" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm removal' }));
    const input = await screen.findByLabelText(/TOTP|code/i);
    fireEvent.change(input, { target: { value: '123456' } });
    const dialogButtons = screen.getAllByRole('button', { name: 'Confirm removal' });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);
    await waitFor(() => expect(api.confirm).toHaveBeenCalledWith('r1', '123456'));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('needs a site and a reason before a request can be made, then sends the code', async () => {
    api.list.mockResolvedValue([]);
    api.request.mockResolvedValue({});
    renderWithProviders(<SiteRemovalSection meEmail="b@uni-b.example.de" />);
    const submit = await screen.findByRole('button', { name: 'Request removal' });
    expect(submit).toBeDisabled();
    const select = await screen.findByLabelText('Site');
    await screen.findByRole('option', { name: /other.example.de/ });
    fireEvent.change(select, { target: { value: 'i2' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Left the network' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    fireEvent.change(await screen.findByLabelText(/TOTP|code/i), { target: { value: '654321' } });
    const buttons = screen.getAllByRole('button', { name: 'Request removal' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith('i2', 'Left the network', '654321'),
    );
  });
});
