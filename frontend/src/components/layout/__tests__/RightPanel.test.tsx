/**
 * RightPanel.test.tsx — the status column: a banner per approval state (none,
 * DRAFT, PENDING with four-eyes progress and silent consent, APPROVED with the
 * reviewer, REJECTED with reason and the resubmit CTA that opens the approval
 * modal), translated history statuses with relative times and review
 * comments, the stats, and a root that leaves positioning to AppPage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useModals } from '../../../hooks/useModals';
import { formatDateTime } from '../../../lib/dateUtils';

const data = vi.hoisted(() => ({
  approval: null as Record<string, unknown> | null,
  history: [] as Record<string, unknown>[],
}));

vi.mock('../../../hooks/useApproval', () => ({
  useApprovalStatus: () => ({ data: data.approval }),
  useApprovalHistory: () => ({ data: data.history }),
}));
vi.mock('../../../hooks/useMemberships', () => ({
  useMemberships: () => ({ data: [{ id: 'm1' }, { id: 'm2' }] }),
}));
vi.mock('../../../hooks/useCertificates', () => ({
  useCertificates: () => ({ data: [] }),
}));
vi.mock('../../../hooks/useOrganization', () => ({
  useOrganization: () => ({ data: { active: true } }),
}));
vi.mock('../../../hooks/useContacts', () => ({
  useContacts: () => ({ data: [] }),
}));
vi.mock('../../../hooks/useEndpoints', () => ({
  useEndpoints: () => ({ data: [] }),
}));

import { RightPanel } from '../RightPanel';

const SUBMITTED = '2026-09-28T09:30:00Z';
const RESOLVED = '2026-09-30T14:05:00Z';

const banner = (container: HTMLElement) => {
  const el = container.querySelector<HTMLElement>('[data-approval-state]');
  if (!el) throw new Error('status banner not rendered');
  return el;
};

beforeEach(() => {
  data.approval = null;
  data.history = [];
  useModals.setState({ open: null, editId: null });
});

describe('RightPanel', () => {
  it('renders the heading, the checklist and translated stats', () => {
    renderWithProviders(<RightPanel instanceId="i1" />);
    expect(screen.getByRole('heading', { name: /approval status/i })).toBeInTheDocument();
    // memberships fixture has 2 entries -> count is rendered next to its label.
    const memberships = screen.getByText('Memberships').closest('div')!;
    expect(within(memberships).getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/ready to submit\?/i)).toBeInTheDocument();
  });

  it('collapses and expands a section from its header', async () => {
    renderWithProviders(<RightPanel instanceId="i1" />);
    const header = screen.getByRole('button', { name: 'Overview' });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    const body = document.getElementById(header.getAttribute('aria-controls') ?? '');
    expect(body).toContainElement(screen.getByText('Memberships'));

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByText('Memberships')).not.toBeInTheDocument());

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Memberships')).toBeInTheDocument();
  });

  it('drops its chrome material inside a drawer', () => {
    renderWithProviders(<RightPanel instanceId="i1" bare />);
    expect(screen.getByRole('complementary', { name: /approval status/i })).not.toHaveClass(
      'glass-chrome',
    );
  });

  it('fills the box AppPage gives it instead of fixing its own position', () => {
    renderWithProviders(<RightPanel instanceId="i1" />);
    const aside = screen.getByRole('complementary', { name: /approval status/i });
    expect(aside).toHaveClass('h-full', 'w-full');
    expect(aside.className).not.toMatch(/\bfixed\b|z-50|w-\[280px\]/);
  });

  it('explains the next step when there is no request yet', () => {
    const { container } = renderWithProviders(<RightPanel instanceId="i1" />);
    expect(banner(container)).toHaveAttribute('data-approval-state', 'NONE');
    expect(within(banner(container)).getByText('No request')).toBeInTheDocument();
    expect(screen.getByText('No approval requests yet.')).toBeInTheDocument();
  });

  it('shows a draft request with its creation date', () => {
    data.approval = { id: 'r0', status: 'DRAFT', created_at: SUBMITTED };
    const { container } = renderWithProviders(<RightPanel instanceId="i1" />);
    const b = banner(container);
    expect(within(b).getByText('Draft')).toBeInTheDocument();
    expect(within(b).getByText(`Created ${formatDateTime(SUBMITTED, 'en')}`)).toBeInTheDocument();
  });

  it('shows a pending request with four-eyes progress and the silent-consent date', () => {
    data.approval = {
      id: 'r1',
      status: 'PENDING',
      created_at: SUBMITTED,
      submitted_at: SUBMITTED,
      fourEyes: { approvals: 1, required: 2, silentConsentAt: RESOLVED },
    };
    const { container } = renderWithProviders(<RightPanel instanceId="i1" />);
    const b = banner(container);
    expect(within(b).getByText('Pending')).toBeInTheDocument();
    expect(within(b).getByText(`Submitted ${formatDateTime(SUBMITTED, 'en')}`)).toBeInTheDocument();
    expect(within(b).getByText('1 of 2 approvals')).toBeInTheDocument();
    expect(
      within(b).getByText(
        `Approved automatically on ${formatDateTime(RESOLVED, 'en')} unless rejected`,
      ),
    ).toBeInTheDocument();
  });

  it('shows the reviewer of an approved request', () => {
    data.approval = {
      id: 'r2',
      status: 'APPROVED',
      created_at: SUBMITTED,
      resolved_at: RESOLVED,
      resolved_by: 'admin@imi.example.de',
    };
    const { container } = renderWithProviders(<RightPanel instanceId="i1" />);
    const b = banner(container);
    expect(within(b).getByText('Approved')).toBeInTheDocument();
    expect(within(b).getByText('Reviewed by admin@imi.example.de')).toBeInTheDocument();
    // No resubmit call to action outside the REJECTED state.
    expect(within(b).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the rejection reason and reopens the approval modal from its CTA', () => {
    data.approval = {
      id: 'r3',
      status: 'REJECTED',
      created_at: SUBMITTED,
      resolved_at: RESOLVED,
      resolved_by: 'admin@imi.example.de',
      comment: 'Certificate expired',
    };
    const { container } = renderWithProviders(<RightPanel instanceId="i1" />);
    const b = banner(container);
    expect(within(b).getByText('Rejected')).toBeInTheDocument();
    expect(within(b).getByText('Certificate expired')).toBeInTheDocument();
    expect(within(b).getByText(`Rejected ${formatDateTime(RESOLVED, 'en')}`)).toBeInTheDocument();

    fireEvent.click(within(b).getByRole('button', { name: /fix the issues and resubmit/i }));
    expect(useModals.getState().open).toBe('approval');
  });

  it('lists the history with translated statuses, relative times and review comments', () => {
    const recent = new Date(Date.now() - 3 * 3600_000).toISOString();
    const older = new Date(Date.now() - 5 * 86_400_000).toISOString();
    data.history = [
      { id: 'h1', status: 'PENDING', created_at: recent, submitted_at: recent },
      {
        id: 'h2',
        status: 'REJECTED',
        created_at: older,
        submitted_at: older,
        resolved_at: older,
        comment: 'Endpoint unreachable',
      },
    ];
    renderWithProviders(<RightPanel instanceId="i1" />, { lang: 'de' });
    const list = screen.getByRole('heading', { name: 'Genehmigungsverlauf' }).nextElementSibling!;
    expect(within(list as HTMLElement).getByText('Ausstehend')).toBeInTheDocument();
    expect(within(list as HTMLElement).getByText('Abgelehnt')).toBeInTheDocument();
    expect(within(list as HTMLElement).getByText('vor 3h')).toBeInTheDocument();
    expect(within(list as HTMLElement).getByText('vor 5d')).toBeInTheDocument();
    expect(within(list as HTMLElement).getByText('Endpoint unreachable')).toBeInTheDocument();
    expect(within(list as HTMLElement).queryByText('PENDING')).not.toBeInTheDocument();
  });
});
