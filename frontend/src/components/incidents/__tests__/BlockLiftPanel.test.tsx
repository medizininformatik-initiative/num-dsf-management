/**
 * BlockLiftPanel.test.tsx — the certificate blocks of a false alarm and their four-eyes lift:
 * blocked and lifted thumbprints are listed, the request needs a reason and the step-up code, the
 * confirm button is disabled for the requester and for an admin of the same e-mail domain, the
 * requester can cancel, a confirm shows the new version, and refusals are worded.
 * incidents.api and useMe are mocked; the real i18n and dialog run in an OTP session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { BlockLiftState, Incident } from '../../../api/incidents.api';

const api = vi.hoisted(() => ({
  blockLifts: vi.fn(),
  requestBlockLift: vi.fn(),
  confirmBlockLift: vi.fn(),
  cancelBlockLift: vi.fn(),
}));
vi.mock('../../../api/incidents.api', () => ({ incidentsApi: api }));
const me = vi.hoisted(() => ({ email: 'b@uni-b.example.de' }));
vi.mock('../../../hooks/useMe', () => ({ useMe: () => ({ data: { email: me.email } }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('../../../lib/authMode', () => ({ isCertMode: () => false, needsTotpStepUp: () => true }));

import { BlockLiftPanel } from '../BlockLiftPanel';

const incident = { id: 'i1', title: 'Leaked key' } as Incident;
const FP1 = 'a'.repeat(128);
const FP2 = 'b'.repeat(128);

const BLOCKED: BlockLiftState = {
  blocks: [
    {
      fingerprint: FP1,
      blockedAt: '2026-11-01T10:00:00Z',
      blockedBy: 'x@imi.de',
      lifted: false,
      liftedAt: null,
      liftedBy: null,
    },
    {
      fingerprint: FP2,
      blockedAt: '2026-11-01T10:00:00Z',
      blockedBy: 'x@imi.de',
      lifted: true,
      liftedAt: '2026-11-02T10:00:00Z',
      liftedBy: 'y@imi.de',
    },
  ],
  request: null,
};
const PENDING: BlockLiftState = {
  blocks: BLOCKED.blocks,
  request: {
    id: 'r1',
    incidentId: 'i1',
    reason: 'It was a drill',
    requestedBy: 'a@uni-a.example.de',
    requestedAt: '2026-11-03T10:00:00Z',
    status: 'PENDING',
    decidedBy: null,
    decidedAt: null,
  },
};

async function openDialog(button: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: button }));
  return user;
}

async function submitWithCode(user: ReturnType<typeof userEvent.setup>, button: string) {
  await user.type(screen.getByLabelText('TOTP Code'), '123456');
  const buttons = screen.getAllByRole('button', { name: button });
  await user.click(buttons[buttons.length - 1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  me.email = 'b@uni-b.example.de';
  api.blockLifts.mockResolvedValue({ data: { data: BLOCKED } });
});

describe('BlockLiftPanel', () => {
  it('lists blocked and lifted thumbprints', async () => {
    renderWithProviders(<BlockLiftPanel incident={incident} />);
    const list = await screen.findByTestId('block-lift-list');
    expect(list).toHaveTextContent('Blocked');
    expect(list).toHaveTextContent('Lifted');
    expect(list).toHaveTextContent('Lifted by y@imi.de');
  });

  it('requests the lift with a reason and the step-up code', async () => {
    api.requestBlockLift.mockResolvedValue({ data: { data: PENDING.request } });
    renderWithProviders(<BlockLiftPanel incident={incident} />);
    const user = await openDialog('Request lifting the blocks');
    await user.type(screen.getByLabelText('Reason'), 'It was a drill');
    await submitWithCode(user, 'Request lifting the blocks');
    await waitFor(() =>
      expect(api.requestBlockLift).toHaveBeenCalledWith('i1', 'It was a drill', '123456'),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('offers no request while one is pending, and none when nothing is blocked', async () => {
    api.blockLifts.mockResolvedValue({ data: { data: PENDING } });
    const first = renderWithProviders(<BlockLiftPanel incident={incident} />);
    await screen.findByTestId('block-lift-request');
    expect(screen.queryByRole('button', { name: 'Request lifting the blocks' })).toBeNull();
    first.unmount();

    api.blockLifts.mockResolvedValue({
      data: { data: { blocks: [BLOCKED.blocks[1]], request: null } },
    });
    renderWithProviders(<BlockLiftPanel incident={incident} />);
    await screen.findByTestId('block-lift-list');
    expect(screen.queryByRole('button', { name: 'Request lifting the blocks' })).toBeNull();
  });

  it('disables Confirm for the requester and for the same e-mail domain', async () => {
    api.blockLifts.mockResolvedValue({ data: { data: PENDING } });
    me.email = 'a@uni-a.example.de';
    const own = renderWithProviders(<BlockLiftPanel incident={incident} />);
    expect(await screen.findByRole('button', { name: 'Confirm lifting' })).toBeDisabled();
    expect(screen.getByText(/You requested this lift/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeInTheDocument();
    own.unmount();

    me.email = 'a2@uni-a.example.de';
    const same = renderWithProviders(<BlockLiftPanel incident={incident} />);
    expect(await screen.findByRole('button', { name: 'Confirm lifting' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull();
    same.unmount();

    me.email = 'b@uni-b.example.de';
    renderWithProviders(<BlockLiftPanel incident={incident} />);
    expect(await screen.findByRole('button', { name: 'Confirm lifting' })).toBeEnabled();
  });

  it('confirms with the step-up code and reports the new version', async () => {
    api.blockLifts.mockResolvedValue({ data: { data: PENDING } });
    api.confirmBlockLift.mockResolvedValue({
      data: { data: { request: PENDING.request, lifted: 1, versionNumber: 9, published: true } },
    });
    renderWithProviders(<BlockLiftPanel incident={incident} />);
    const user = await openDialog('Confirm lifting');
    await submitWithCode(user, 'Confirm lifting');
    await waitFor(() => expect(api.confirmBlockLift).toHaveBeenCalledWith('i1', 'r1', '123456'));
    expect(toast.success).toHaveBeenCalledWith(
      'Blocks lifted (1). Allow list version 9 published.',
    );
  });

  it('words a refusal of the backend', async () => {
    api.blockLifts.mockResolvedValue({ data: { data: PENDING } });
    api.confirmBlockLift.mockRejectedValue({
      response: { status: 403, data: { error: { code: 'SAME_SITE' } } },
    });
    renderWithProviders(<BlockLiftPanel incident={incident} />);
    const user = await openDialog('Confirm lifting');
    await submitWithCode(user, 'Confirm lifting');
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'The confirming admin must belong to a different e-mail domain than the requester.',
      ),
    );
  });
});
