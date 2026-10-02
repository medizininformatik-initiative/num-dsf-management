/**
 * TopBar.test.tsx — navigation controls, the translated title with the
 * environment badge, and the instance actions: one primary CTA that is
 * disabled and relabelled "Waiting for approval" while the active instance has
 * a PENDING request. Entity and approval hooks are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useCanvasStore } from '../../../stores/canvas.store';

const approval = vi.hoisted(() => ({ data: null as Record<string, unknown> | null }));
const useApprovalStatus = vi.hoisted(() => vi.fn(() => ({ data: approval.data })));

// SearchBar (rendered when showInstanceActions) pulls in entity hooks — stub them all.
vi.mock('../../../hooks/useOrganization', () => ({ useOrganization: () => ({ data: null }) }));
vi.mock('../../../hooks/useContacts', () => ({ useContacts: () => ({ data: [] }) }));
vi.mock('../../../hooks/useEndpoints', () => ({ useEndpoints: () => ({ data: [] }) }));
vi.mock('../../../hooks/useCertificates', () => ({ useCertificates: () => ({ data: [] }) }));
vi.mock('../../../hooks/useMemberships', () => ({ useMemberships: () => ({ data: [] }) }));
vi.mock('../../../hooks/useApproval', () => ({ useApprovalStatus }));

import { TopBar } from '../TopBar';

beforeEach(() => {
  approval.data = null;
  useApprovalStatus.mockClear();
  useCanvasStore.setState({ activeInstanceId: 'i1' });
});

describe('TopBar', () => {
  it('renders navigation controls without instance actions', () => {
    renderWithProviders(<TopBar onDownload={vi.fn()} onApproval={vi.fn()} />);
    expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
    expect(screen.getByText(/Allow List Management/i)).toBeInTheDocument();
    // Instance-only actions hidden by default, and no approval query for them.
    expect(screen.queryByRole('button', { name: /send for approval/i })).not.toBeInTheDocument();
    expect(useApprovalStatus).toHaveBeenCalledWith(null);
  });

  it('marks the environment and translates the title', () => {
    renderWithProviders(<TopBar onDownload={vi.fn()} onApproval={vi.fn()} />, { lang: 'de' });
    expect(screen.getByText('Allow-List-Verwaltung')).toBeInTheDocument();
    const badge = screen.getByText('Testumgebung').closest('[data-env]');
    expect(badge).toHaveAttribute('data-env', 'TEST');
  });

  it('renders download and approval actions when showInstanceActions is set', () => {
    const onDownload = vi.fn();
    const onApproval = vi.fn();
    renderWithProviders(
      <TopBar onDownload={onDownload} onApproval={onApproval} showInstanceActions />,
    );
    const send = screen.getByRole('button', { name: /send for approval/i });
    expect(send).toBeEnabled();
    expect(send).toHaveClass('btn-primary');
    fireEvent.click(screen.getByRole('button', { name: /download allow list/i }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    fireEvent.click(send);
    expect(onApproval).toHaveBeenCalledTimes(1);
    expect(useApprovalStatus).toHaveBeenCalledWith('i1');
  });

  it('disables and relabels the approval action while a request is pending', () => {
    approval.data = { status: 'PENDING' };
    const onApproval = vi.fn();
    renderWithProviders(
      <TopBar onDownload={vi.fn()} onApproval={onApproval} showInstanceActions />,
    );
    expect(screen.queryByRole('button', { name: /send for approval/i })).not.toBeInTheDocument();
    const waiting = screen.getByRole('button', { name: /waiting for approval/i });
    expect(waiting).toBeDisabled();
    fireEvent.click(waiting);
    expect(onApproval).not.toHaveBeenCalled();
  });

  it('offers the approval action again after a rejection', () => {
    approval.data = { status: 'REJECTED' };
    renderWithProviders(<TopBar onDownload={vi.fn()} onApproval={vi.fn()} showInstanceActions />);
    expect(screen.getByRole('button', { name: /send for approval/i })).toBeEnabled();
  });
});
