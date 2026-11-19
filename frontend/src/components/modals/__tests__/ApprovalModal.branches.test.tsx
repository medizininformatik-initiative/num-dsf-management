/**
 * ApprovalModal.branches.test.tsx — covers the submit-path branches the base
 * ApprovalModal.test.tsx does not: a fully-passing checklist enabling submit,
 * the success path (guard-wrapped mutateAsync → success toast + onClose), the
 * ALREADY_PENDING and ORGANIZATION_NOT_FOUND failures mapped to their toasts,
 * the generic failure path (getErrorMessage), the empty draft state rendering
 * every per-section "no X" placeholder, the shared readiness rule (expired
 * certificate, inactive organization), the request state shown up front
 * (PENDING blocks submit, REJECTED shows its reason) and open items that close
 * the dialog and jump to their card. The cross-user guard runs through its
 * real default context (executes the action directly), and sonner is mocked
 * so toast calls are asserted without side effects. The real i18n translator
 * runs, so asserted strings are the actual rendered output.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useI18n } from '../../../stores/i18n.store';
import { useCanvasStore } from '../../../stores/canvas.store';

// Hoisted submit double + per-test data state so each hook returns the shape the
// component expects while letting individual tests flip the checklist outcome.
const mutateAsync = vi.hoisted(() => vi.fn());
const withdrawAsync = vi.hoisted(() => vi.fn());
const data = vi.hoisted(() => ({
  org: null as Record<string, unknown> | null,
  contacts: [] as Record<string, unknown>[],
  endpoints: [] as Record<string, unknown>[],
  certs: [] as Record<string, unknown>[],
  memberships: [] as Record<string, unknown>[],
  approval: null as Record<string, unknown> | null,
  history: [] as Record<string, unknown>[],
}));

vi.mock('../../../hooks/useApproval', () => ({
  useSubmitApproval: () => ({ mutate: vi.fn(), mutateAsync, isPending: false }),
  useApprovalStatus: () => ({ data: data.approval, isLoading: false }),
  useWithdrawApproval: () => ({ mutateAsync: withdrawAsync, isPending: false }),
  useApprovalHistory: () => ({ data: data.history, isLoading: false }),
}));
vi.mock('../../../hooks/useOrganization', () => ({
  useOrganization: () => ({ data: data.org, isLoading: false }),
}));
vi.mock('../../../hooks/useContacts', () => ({
  useContacts: () => ({ data: data.contacts, isLoading: false }),
}));
vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({ data: data.endpoints, isLoading: false }),
}));
vi.mock('../../../hooks/useCertificates', () => ({
  useCertificates: () => ({ data: data.certs, isLoading: false }),
  useUpdateCertificatePurpose: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../../hooks/useMemberships', () => ({
  useMemberships: () => ({ data: data.memberships, isLoading: false }),
}));

const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
  toast: { error: toastError, success: toastSuccess },
}));

import { ApprovalModal } from '../ApprovalModal';

const t = useI18n.getState().t;
const submitButton = () => screen.getByRole('button', { name: /send request for approval/i });

/** Populate every entity so all five readiness checks pass and submit enables. */
function seedPassingData() {
  data.org = {
    identifier: 'ukm.de',
    name: 'Uniklinik Münster',
    email: 'dsf@ukm.de',
    city: 'Münster',
    country_code: 'DE',
    active: true,
  };
  data.contacts = [{ id: 'c1', name: 'Dr. House', types: ['MEDIC'], email_validated: true }];
  data.endpoints = [
    { identifier: 'ep-1', name: 'UKM FHIR', address: 'https://ukm.de/fhir', ipAddresses: [] },
  ];
  data.certs = [{ id: 'cert-1', subject: 'CN=ukm.de', valid_until: '2030-01-01' }];
  data.memberships = [{ id: 'm1', parent_organization: 'num.de', roles: ['DIC'] }];
  data.approval = null;
}

function seedEmptyData() {
  data.org = null;
  data.contacts = [];
  data.endpoints = [];
  data.certs = [];
  data.memberships = [];
  data.approval = null;
  data.history = [];
}

beforeEach(() => {
  vi.clearAllMocks();
  seedEmptyData();
  useCanvasStore.setState({ highlightedEntity: null, highlightedKey: null });
});

describe('ApprovalModal — submit + empty-state branches', () => {
  it('enables submit, runs the guarded mutation, toasts success and closes when every check passes', async () => {
    seedPassingData();
    mutateAsync.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();

    renderWithProviders(<ApprovalModal open onClose={onClose} instanceId="i1" />);

    expect(screen.getByText(t('approvalModalAllPassed'))).toBeInTheDocument();
    const submit = submitButton();
    expect(submit).toBeEnabled();

    fireEvent.click(submit);

    await waitFor(
      () => expect(toastSuccess).toHaveBeenCalledWith(t('approvalModalSubmitSuccess')),
      {
        timeout: 4000,
      },
    );
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('maps an ALREADY_PENDING failure to the dedicated toast and keeps the modal open', async () => {
    seedPassingData();
    mutateAsync.mockRejectedValueOnce({
      response: { data: { error: { message: 'ALREADY_PENDING' } } },
    });
    const onClose = vi.fn();

    renderWithProviders(<ApprovalModal open onClose={onClose} instanceId="i1" />);

    fireEvent.click(submitButton());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(t('approvalModalAlreadyPending')), {
      timeout: 4000,
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('maps ORGANIZATION_NOT_FOUND to a translated message', async () => {
    seedPassingData();
    mutateAsync.mockRejectedValueOnce({
      response: {
        data: { error: { code: 'ORGANIZATION_NOT_FOUND', message: 'ORGANIZATION_NOT_FOUND' } },
      },
    });

    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);
    fireEvent.click(submitButton());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(t('approvalModalOrgMissing')), {
      timeout: 4000,
    });
  });

  it('surfaces a generic backend error message on the failure path', async () => {
    seedPassingData();
    mutateAsync.mockRejectedValueOnce({
      response: { data: { error: { message: 'Backend exploded' } } },
    });
    const onClose = vi.fn();

    renderWithProviders(<ApprovalModal open onClose={onClose} instanceId="i1" />);

    fireEvent.click(submitButton());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Backend exploded'), {
      timeout: 4000,
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders every per-section empty placeholder and disables submit for an empty draft', () => {
    const onClose = vi.fn();
    renderWithProviders(<ApprovalModal open onClose={onClose} instanceId="i1" />);

    expect(screen.getByText(t('approvalModalSomeFailed'))).toBeInTheDocument();
    expect(screen.getByText(t('approvalModalNoContacts'))).toBeInTheDocument();
    expect(screen.getByText(t('approvalModalNoEndpoints'))).toBeInTheDocument();
    expect(screen.getByText(t('approvalModalNoCerts'))).toBeInTheDocument();
    expect(screen.getByText(t('approvalModalNoMemberships'))).toBeInTheDocument();

    expect(submitButton()).toBeDisabled();
  });
});

describe('ApprovalModal — shared readiness rule', () => {
  it('does not accept an expired certificate', () => {
    seedPassingData();
    data.certs = [{ id: 'cert-1', subject: 'CN=ukm.de', valid_until: '2001-01-01' }];
    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);

    expect(screen.getByRole('button', { name: /Missing Valid certificate/ })).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it('blocks submit with a message when no valid certificate is published in the allow list', () => {
    seedPassingData();
    data.certs = [
      { id: 'cert-1', subject: 'CN=ukm.de', valid_until: '2099-01-01', publishInAllowlist: false },
    ];
    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);

    expect(screen.getByText(t('certPurposeNonePublished'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Missing Valid certificate/ })).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it('lets a deactivated organization request its withdrawal', async () => {
    // Withdrawing needs none of the publishing steps: no contacts or certificates.
    seedPassingData();
    data.org = { ...data.org, active: 0 };
    data.contacts = [];
    data.certs = [];
    mutateAsync.mockResolvedValueOnce(undefined);
    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);

    expect(screen.getByText(t('approvalWithdrawalTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('approvalModalInactive'))).toBeInTheDocument();
    expect(screen.queryByText(t('approvalModalSomeFailed'))).not.toBeInTheDocument();
    const submit = screen.getByRole('button', { name: t('approvalWithdrawalSubmit') });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1), { timeout: 4000 });
  });

  it('shows the running request instead of a second withdrawal request while one is pending', () => {
    seedPassingData();
    data.org = { ...data.org, active: 0 };
    data.approval = { id: 'r1', status: 'PENDING', created_at: '2026-10-01T10:00:00Z' };
    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);

    expect(screen.getByTestId('approval-running-request')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('approvalWithdrawalSubmit') })).toBeNull();
  });

  it('closes and jumps to the card of an open item', () => {
    seedPassingData();
    data.memberships = [];
    const card = document.createElement('div');
    card.id = 'card-memberships';
    card.scrollIntoView = vi.fn();
    document.body.appendChild(card);
    const onClose = vi.fn();
    renderWithProviders(<ApprovalModal open onClose={onClose} instanceId="i1" />);

    fireEvent.click(screen.getByRole('button', { name: /Missing Membership/ }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useCanvasStore.getState().highlightedEntity).toBe('memberships');
    expect(card.scrollIntoView).toHaveBeenCalled();
    card.remove();
  });
});

describe('ApprovalModal — request state up front', () => {
  const running = {
    id: 'r1',
    status: 'PENDING',
    created_at: '2026-09-28T09:30:00Z',
    submitted_at: '2026-09-28T09:30:00Z',
    submitted_by: 'admin@klinik.example.de',
    snapshot_json: JSON.stringify({
      contacts: [{}, {}],
      endpoints: [{}],
      certificates: [{}],
      memberships: [{}, {}, {}],
    }),
    fourEyes: { approvals: 1, required: 2, silentConsentAt: null },
  };

  it('shows the running request on a pending request: submitter, contents, four-eyes progress', () => {
    seedPassingData();
    data.approval = running;
    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);

    expect(screen.getByRole('heading', { name: t('approvalRunningTitle') })).toBeInTheDocument();
    expect(screen.getByText('admin@klinik.example.de')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 approvals')).toBeInTheDocument();
    const panel = screen.getByTestId('approval-running-request');
    expect(panel).toHaveTextContent(/Contacts\s*2|2\s*Contacts/);
    expect(panel).toHaveTextContent('3');
    expect(screen.queryByRole('button', { name: /send request for approval/i })).toBeNull();
    expect(screen.getByRole('button', { name: t('approvalWithdrawBtn') })).toBeEnabled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('withdraws after the confirmation and closes', async () => {
    seedPassingData();
    data.approval = running;
    withdrawAsync.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    renderWithProviders(<ApprovalModal open onClose={onClose} instanceId="i1" />);

    fireEvent.click(screen.getByRole('button', { name: t('approvalWithdrawBtn') }));
    const dialog = await screen.findByRole('alertdialog');
    expect(withdrawAsync).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: t('approvalWithdrawBtn') }));

    await waitFor(() => expect(withdrawAsync).toHaveBeenCalledTimes(1), { timeout: 4000 });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith(t('approvalWithdrawSuccess'));
  });

  it('does not withdraw when the confirmation is cancelled', async () => {
    seedPassingData();
    data.approval = running;
    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);

    fireEvent.click(screen.getByRole('button', { name: t('approvalWithdrawBtn') }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(withdrawAsync).not.toHaveBeenCalled();
  });

  it('tells the user when the request was decided in the meantime', async () => {
    seedPassingData();
    data.approval = running;
    withdrawAsync.mockRejectedValueOnce({
      response: { data: { error: { code: 'NOT_PENDING', message: 'x' } } },
    });
    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);

    fireEvent.click(screen.getByRole('button', { name: t('approvalWithdrawBtn') }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: t('approvalWithdrawBtn') }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(t('approvalWithdrawNotPending')));
  });

  it('says so when there is no request yet and the history is empty', () => {
    seedPassingData();
    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);

    expect(screen.getByText(t('approvalBannerNone'))).toBeInTheDocument();
    const history = screen.getByTestId('approval-history');
    expect(history).toHaveTextContent(t('noApprovalRequests'));
  });

  it('disables submit and shows a hint when nothing changed since the last approval', () => {
    seedPassingData();
    data.approval = { id: 'r1', status: 'APPROVED', changedSinceApproval: false };
    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(t('approvalNoChangesHint'))).toBeInTheDocument();
  });

  it.each([true, null])('keeps submit enabled when changedSinceApproval is %s', (v) => {
    seedPassingData();
    data.approval = { id: 'r1', status: 'APPROVED', changedSinceApproval: v };
    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);
    expect(submitButton()).toBeEnabled();
    expect(screen.queryByText(t('approvalNoChangesHint'))).not.toBeInTheDocument();
  });

  it('lists the full history with the last approved date, in both dialog states', () => {
    seedPassingData();
    data.history = [
      {
        id: 'h3',
        status: 'PENDING',
        created_at: '2026-10-03T10:00:00Z',
        submitted_at: '2026-10-03T10:00:00Z',
      },
      {
        id: 'h2',
        status: 'REJECTED',
        created_at: '2026-09-20T10:00:00Z',
        submitted_at: '2026-09-20T10:00:00Z',
        comment: 'Wrong endpoint address',
      },
      {
        id: 'h1',
        status: 'APPROVED',
        created_at: '2026-09-01T10:00:00Z',
        submitted_at: '2026-09-01T10:00:00Z',
        resolved_at: '2026-09-02T10:00:00Z',
      },
    ];
    data.approval = { ...running };
    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);

    const history = screen.getByTestId('approval-history');
    const items = within(history).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Request #3');
    expect(items[2]).toHaveTextContent('Request #1');
    expect(within(history).getByText('Wrong endpoint address')).toBeInTheDocument();
    expect(history).toHaveTextContent(t('lastApproved'));
  });

  it('offers a fresh submit again after a withdrawal', () => {
    seedPassingData();
    data.approval = {
      id: 'r4',
      status: 'WITHDRAWN',
      created_at: '2026-09-28T09:30:00Z',
      resolved_at: '2026-09-29T09:30:00Z',
    };
    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);

    expect(screen.getByText(t('approvalBannerWithdrawn'))).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it('shows the rejection reason and allows resubmitting', () => {
    seedPassingData();
    data.approval = {
      id: 'r2',
      status: 'REJECTED',
      created_at: '2026-09-28T09:30:00Z',
      resolved_at: '2026-09-30T14:05:00Z',
      resolved_by: 'admin@imi.example.de',
      comment: 'Wrong endpoint address',
    };
    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);

    expect(screen.getByText('Wrong endpoint address')).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it('notes that an approved request can be followed by a new review', () => {
    seedPassingData();
    data.approval = {
      id: 'r3',
      status: 'APPROVED',
      created_at: '2026-09-28T09:30:00Z',
      resolved_at: '2026-09-30T14:05:00Z',
      resolved_by: 'admin@imi.example.de',
    };
    renderWithProviders(<ApprovalModal open onClose={vi.fn()} instanceId="i1" />);

    expect(screen.getByText(t('approvalModalApprovedHint'))).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });
});
