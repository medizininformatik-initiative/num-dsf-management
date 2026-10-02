/**
 * RequestCard.test.tsx — covers the admin approval-request card: it renders the
 * header (org name + identifier), the Pending status badge, the relative
 * submitted time, the approvals counter and any existing approval signatures.
 * Approve forwards the request id + 6-digit TOTP to the approve mutation; Reject
 * opens the comment panel and forwards id + comment + TOTP to the reject
 * mutation. The cross-user guard and pending-spinner branches are driven by
 * tweaking the signatures prop and the hoisted mutation state. useAdmin and
 * sonner are mocked so no network/toast side effects occur; the real i18n
 * translator and relTime run so asserted text is the actual rendered output.
 * Why Approve is disabled is asserted as visible text linked to the button.
 * A separate describe block mocks lib/authMode to exercise cert mode, where
 * the TOTP input is not rendered, approve/reject omit totpCode entirely and
 * Approve first asks for confirmation (useConfirm) with a summary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { ApprovalSignature } from '../../../api/admin.api';
import { useI18n } from '../../../stores/i18n.store';

// Hoisted mutation doubles. `state` is mutated per test to flip isPending so the
// disabled-while-pending and spinner-label branches can be exercised.
const approveMutateAsync = vi.hoisted(() => vi.fn());
const rejectMutateAsync = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ approvePending: false, rejectPending: false }));

vi.mock('../../../hooks/useAdmin', () => ({
  useApproveRequest: () => ({
    mutateAsync: approveMutateAsync,
    isPending: state.approvePending,
  }),
  useRejectRequest: () => ({
    mutateAsync: rejectMutateAsync,
    isPending: state.rejectPending,
  }),
}));

const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
  toast: { error: toastError, success: toastSuccess },
}));

// Defaults to OTP mode (cert: false) so every existing test below runs
// through the real needsTotpStepUp()===true behaviour unchanged; the cert
// mode describe block flips this before rendering.
const authMode = vi.hoisted(() => ({ cert: false }));
vi.mock('../../../lib/authMode', () => ({
  isCertMode: () => authMode.cert,
  needsTotpStepUp: () => !authMode.cert,
}));

import { RequestCard } from '../RequestCard';

const t = useI18n.getState().t;

const SNAPSHOT = {
  organization: {
    name: 'Uniklinik Münster',
    identifier: 'ukm.de',
    email: 'dsf@ukm.de',
    city: 'Münster',
    country_code: 'DE',
  },
  endpoints: [
    {
      identifier: 'ep-1',
      name: 'UKM FHIR',
      address: 'https://ukm.de/fhir',
      ips: [{ ip: '10.0.0.5', is_fhir: true }],
    },
  ],
  contacts: [{ name: 'Dr. Admin', email: 'admin@ukm.de', types: ['DSF_ADMIN'] }],
};

// ~3 days ago — far enough into the past that relTime resolves to "{n}d ago"
// deterministically without fake timers.
const THREE_DAYS_AGO = new Date(Date.now() - 3 * 86400_000).toISOString();

function makeRequest(
  overrides: {
    signatures?: ApprovalSignature[];
    submitted_at?: string;
    created_at?: string;
  } = {},
) {
  return {
    id: 'req-1',
    status: 'PENDING',
    submitted_at: THREE_DAYS_AGO,
    snapshot_json: SNAPSHOT,
    signatures: [],
    ...overrides,
  };
}

beforeEach(() => {
  useI18n.getState().setLang('en');
  approveMutateAsync.mockReset();
  rejectMutateAsync.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  state.approvePending = false;
  state.rejectPending = false;
  authMode.cert = false;
  approveMutateAsync.mockResolvedValue({ data: { status: 'APPROVED' } });
  rejectMutateAsync.mockResolvedValue(undefined);
});

describe('RequestCard', () => {
  it('renders the header, pending status, relative time and approvals counter', () => {
    renderWithProviders(<RequestCard request={makeRequest()} meEmail="op@imi.de" />);

    expect(screen.getByText('Uniklinik Münster')).toBeInTheDocument();
    expect(screen.getByText('ukm.de')).toBeInTheDocument();
    expect(screen.getByText(t('pending'))).toBeInTheDocument();
    // relTime against a ~3-day-old timestamp → "3d ago".
    expect(screen.getByText(t('relAgoDays', { n: 3 }))).toBeInTheDocument();
    // No signatures yet → 0/2 approvals.
    expect(screen.getByText(t('adminApprovals', { n: 0 }))).toBeInTheDocument();
  });

  it('renders existing approval signatures (resolved/partial branch)', () => {
    const sig: ApprovalSignature = {
      id: 'sig-1',
      admin_email: 'peer@other.de',
      admin_site: 'other.de',
      decision: 'APPROVE',
      signed_at: THREE_DAYS_AGO,
    };
    renderWithProviders(
      <RequestCard request={makeRequest({ signatures: [sig] })} meEmail="op@imi.de" />,
    );

    expect(screen.getByText(t('adminApprovals', { n: 1 }))).toBeInTheDocument();
    expect(screen.getByText(/peer@other\.de/)).toBeInTheDocument();
    // One existing approval triggers the silent-consent auto-approve note.
    expect(screen.getByText(/Auto-approves on/)).toBeInTheDocument();
  });

  it('expands to show the submitted-data snapshot', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestCard request={makeRequest()} meEmail="op@imi.de" />);

    // Snapshot section content is not rendered until expanded.
    expect(screen.queryByText('https://ukm.de/fhir')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /view submitted data/i }));

    expect(screen.getByText('UKM FHIR')).toBeInTheDocument();
    expect(screen.getByText('https://ukm.de/fhir')).toBeInTheDocument();
    expect(screen.getByText('Dr. Admin')).toBeInTheDocument();
  });

  it('approve forwards the request id + 6-digit TOTP to the approve mutation', async () => {
    renderWithProviders(<RequestCard request={makeRequest()} meEmail="op@imi.de" />);

    fireEvent.change(screen.getByPlaceholderText(t('adminTotpPlaceholder')), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('adminApproveBtn') }));

    await waitFor(() => expect(approveMutateAsync).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(approveMutateAsync.mock.calls[0][0]).toEqual({
      requestId: 'req-1',
      totpCode: '123456',
    });
    expect(toastSuccess).toHaveBeenCalledWith(t('adminToastApproveSuccess'));
  });

  it('approve without a complete TOTP code errors and never calls the mutation', () => {
    renderWithProviders(<RequestCard request={makeRequest()} meEmail="op@imi.de" />);

    // Only 3 digits entered — guard should reject before mutating.
    fireEvent.change(screen.getByPlaceholderText(t('adminTotpPlaceholder')), {
      target: { value: '123' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('adminApproveBtn') }));

    expect(approveMutateAsync).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(t('adminToastTotpRequired'));
  });

  it('reject with a comment + TOTP forwards id, comment and code to the reject mutation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestCard request={makeRequest()} meEmail="op@imi.de" />);

    // The comment panel only appears after clicking the outer Reject button.
    await user.click(screen.getByRole('button', { name: t('adminRejectBtn') }));
    expect(screen.getByText(t('adminRejectionReasonLabel'))).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(t('adminRejectionReasonPlaceholder')), {
      target: { value: 'Missing endpoint TLS metadata' },
    });
    fireEvent.change(screen.getByPlaceholderText(t('adminTotpPlaceholder')), {
      target: { value: '654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('adminConfirmRejectBtn') }));

    await waitFor(() => expect(rejectMutateAsync).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(rejectMutateAsync.mock.calls[0][0]).toEqual({
      requestId: 'req-1',
      comment: 'Missing endpoint TLS metadata',
      totpCode: '654321',
    });
    expect(toastSuccess).toHaveBeenCalledWith(t('adminToastRejectSuccess'));
  });

  it('reject without a reason errors and never calls the mutation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestCard request={makeRequest()} meEmail="op@imi.de" />);

    await user.click(screen.getByRole('button', { name: t('adminRejectBtn') }));
    fireEvent.change(screen.getByPlaceholderText(t('adminTotpPlaceholder')), {
      target: { value: '654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('adminConfirmRejectBtn') }));

    expect(rejectMutateAsync).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(t('adminToastReasonRequired'));
  });

  it.each([
    [
      'the viewer already decided',
      [{ admin_email: 'op@imi.de', admin_site: 'imi.de', decision: 'REJECT' as const }],
      'You already decided this request',
    ],
    [
      'an admin from the same site approved',
      [{ admin_email: 'colleague@imi.de', admin_site: 'imi.de', decision: 'APPROVE' as const }],
      'Another admin from your site has already approved',
    ],
    [
      'two admins approved',
      [
        { admin_email: 'a@one.de', admin_site: 'one.de', decision: 'APPROVE' as const },
        { admin_email: 'b@two.de', admin_site: 'two.de', decision: 'APPROVE' as const },
      ],
      'Already approved by 2 admins',
    ],
  ])('says why Approve is disabled when %s', (_case, partial, reason) => {
    const signatures: ApprovalSignature[] = partial.map((s, i) => ({
      id: `sig-${i}`,
      signed_at: THREE_DAYS_AGO,
      ...s,
    }));
    renderWithProviders(<RequestCard request={makeRequest({ signatures })} meEmail="op@imi.de" />);

    const approveBtn = screen.getByRole('button', { name: t('adminApproveBtn') });
    expect(approveBtn).toBeDisabled();
    // Visible text, not only a tooltip, and linked to the button.
    const note = screen.getByText(reason);
    expect(note).toBeVisible();
    expect(approveBtn).toHaveAttribute('aria-describedby', note.id);
    expect(approveBtn).not.toHaveAttribute('title');
  });

  it('disables approve while an approve mutation is pending and shows the spinner label', () => {
    state.approvePending = true;
    renderWithProviders(<RequestCard request={makeRequest()} meEmail="op@imi.de" />);

    const approveBtn = screen.getByRole('button', { name: t('adminApprovingBtn') });
    expect(approveBtn).toBeDisabled();

    // Even with a valid code, a click while pending must not start a new mutation.
    fireEvent.change(screen.getByPlaceholderText(t('adminTotpPlaceholder')), {
      target: { value: '123456' },
    });
    fireEvent.click(approveBtn);
    expect(approveMutateAsync).not.toHaveBeenCalled();
  });
});

describe('RequestCard (cert mode)', () => {
  beforeEach(() => {
    authMode.cert = true;
  });

  it('renders no TOTP input, confirms the final decision, then approves with only { requestId }', async () => {
    renderWithProviders(<RequestCard request={makeRequest()} meEmail="op@imi.de" />);

    expect(screen.queryByPlaceholderText(t('adminTotpPlaceholder'))).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t('adminApproveBtn') }));

    // Without the TOTP step-up the click alone must not decide: a summary comes first.
    const dialog = await screen.findByRole('alertdialog', { name: 'Approve this request?' });
    expect(within(dialog).getByText('Uniklinik Münster')).toBeInTheDocument();
    expect(within(dialog).getByText('ukm.de')).toBeInTheDocument();
    expect(
      within(dialog).getByText('1 Endpoint(s) · 0 Certificate(s) · 0 Membership(s) · 1 Contact(s)'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/This is the first of two approvals/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Your decision is final: you cannot change or withdraw it afterwards.',
      ),
    ).toBeInTheDocument();
    expect(approveMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: t('adminApproveBtn') }));

    await waitFor(() => expect(approveMutateAsync).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const arg = approveMutateAsync.mock.calls[0][0];
    expect(arg).toEqual({ requestId: 'req-1' });
    expect(Object.prototype.hasOwnProperty.call(arg, 'totpCode')).toBe(false);
    expect(toastSuccess).toHaveBeenCalledWith(t('adminToastApproveSuccess'));
  });

  it('does not approve when the confirmation is cancelled', async () => {
    renderWithProviders(<RequestCard request={makeRequest()} meEmail="op@imi.de" />);
    fireEvent.click(screen.getByRole('button', { name: t('adminApproveBtn') }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: t('cancel') }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(approveMutateAsync).not.toHaveBeenCalled();
  });

  it('tells the second approver that the request is approved at once', async () => {
    const sig: ApprovalSignature = {
      id: 'sig-1',
      admin_email: 'peer@other.de',
      admin_site: 'other.de',
      decision: 'APPROVE',
      signed_at: THREE_DAYS_AGO,
    };
    renderWithProviders(
      <RequestCard request={makeRequest({ signatures: [sig] })} meEmail="op@imi.de" />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('adminApproveBtn') }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(
        'This is the second approval: the request is approved at once and enters the allow-list bundle.',
      ),
    ).toBeInTheDocument();
  });

  it('rejects with only { requestId, comment } (no totpCode key)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestCard request={makeRequest()} meEmail="op@imi.de" />);

    await user.click(screen.getByRole('button', { name: t('adminRejectBtn') }));
    expect(screen.queryByPlaceholderText(t('adminTotpPlaceholder'))).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(t('adminRejectionReasonPlaceholder')), {
      target: { value: 'Missing endpoint TLS metadata' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('adminConfirmRejectBtn') }));

    await waitFor(() => expect(rejectMutateAsync).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const arg = rejectMutateAsync.mock.calls[0][0];
    expect(arg).toEqual({ requestId: 'req-1', comment: 'Missing endpoint TLS metadata' });
    expect(Object.prototype.hasOwnProperty.call(arg, 'totpCode')).toBe(false);
    expect(toastSuccess).toHaveBeenCalledWith(t('adminToastRejectSuccess'));
  });
});
