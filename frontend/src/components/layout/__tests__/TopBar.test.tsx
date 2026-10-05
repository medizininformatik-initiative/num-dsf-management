/**
 * TopBar.test.tsx — no history arrows and no duplicate product title
 * or environment badge (both live in the sidebar), and the instance actions: one primary CTA that is
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
  it('renders without history arrows or instance actions', () => {
    renderWithProviders(<TopBar onDownload={vi.fn()} onApproval={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /go back|go forward/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /toggle theme/i })).toBeInTheDocument();
    // Instance-only actions hidden by default, and no approval query for them.
    expect(screen.queryByRole('button', { name: /send for approval/i })).not.toBeInTheDocument();
    expect(useApprovalStatus).toHaveBeenCalledWith(null);
  });

  it('leaves the product name and the environment to the sidebar', () => {
    const { container } = renderWithProviders(
      <TopBar onDownload={vi.fn()} onApproval={vi.fn()} />,
      { lang: 'de' },
    );
    expect(container.querySelector('[data-env]')).toBeNull();
    expect(screen.queryByText('Testumgebung')).not.toBeInTheDocument();
    expect(screen.queryByText(/Allow-List-Verwaltung|DSF Management Tool/)).not.toBeInTheDocument();
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

  it('shows a "request running" pill that opens the running request while one is pending', () => {
    approval.data = { status: 'PENDING' };
    const onApproval = vi.fn();
    renderWithProviders(
      <TopBar onDownload={vi.fn()} onApproval={onApproval} showInstanceActions />,
    );
    expect(screen.queryByRole('button', { name: /send for approval/i })).not.toBeInTheDocument();
    const running = screen.getByRole('button', { name: /request running/i });
    expect(running).toBeEnabled();
    expect(running).toHaveTextContent('Request running');
    fireEvent.click(running);
    expect(onApproval).toHaveBeenCalledTimes(1);
  });

  it('offers the approval action again after a rejection', () => {
    approval.data = { status: 'REJECTED' };
    renderWithProviders(<TopBar onDownload={vi.fn()} onApproval={vi.fn()} showInstanceActions />);
    expect(screen.getByRole('button', { name: /send for approval/i })).toBeEnabled();
  });
});
