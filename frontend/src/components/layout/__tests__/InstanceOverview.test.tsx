/**
 * InstanceOverview.test.tsx – the dashboard strip: one entry per instance with
 * its approval status and last approval date, selecting switches the active
 * instance, archived instances are hidden until "Show archived" is ticked,
 * owners can archive (confirm dialog says the site stays published) and delete
 * only an instance that was never approved, and a 409 on delete is explained.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useCanvasStore } from '../../../stores/canvas.store';
import type { InstanceOverviewRow } from '../../../hooks/useInstance';

let rows: InstanceOverviewRow[] = [];
let me = { email: 'owner@example.de', isAdmin: false };
const archiveInstance = vi.hoisted(() => vi.fn());
const unarchiveInstance = vi.hoisted(() => vi.fn());
const deleteInstance = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/useInstance', () => ({
  useInstanceOverview: () => ({ data: rows }),
}));
vi.mock('../../../hooks/useMe', () => ({ useMe: () => ({ data: me }) }));
vi.mock('../../../api/entities.api', () => ({
  api: () => ({ archiveInstance, unarchiveInstance, deleteInstance }),
}));
vi.mock('../../../lib/authMode', () => ({
  isCertMode: () => true,
  needsTotpStepUp: () => false,
}));

import { InstanceOverview } from '../InstanceOverview';

function row(over: Partial<InstanceOverviewRow>): InstanceOverviewRow {
  return {
    id: 'i1',
    label: 'ukm.de',
    is_owner: true,
    archived_at: null,
    approval_status: 'NONE',
    last_approved_at: null,
    ...over,
  };
}

describe('InstanceOverview', () => {
  beforeEach(() => {
    me = { email: 'owner@example.de', isAdmin: false };
    archiveInstance.mockReset().mockResolvedValue({});
    unarchiveInstance.mockReset().mockResolvedValue({});
    deleteInstance.mockReset().mockResolvedValue({});
    useCanvasStore.setState({ activeInstanceId: 'i1' });
    localStorage.clear();
  });

  it('shows the instance count and collapses, remembering the choice per user', () => {
    rows = [row({ id: 'i1' }), row({ id: 'i2', label: 'ukb.de' })];
    const first = renderWithProviders(<InstanceOverview />);
    const toggle = screen.getByRole('button', { name: /Your instances \(2\)/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('instance-overview-i1')).not.toBeInTheDocument();
    expect(localStorage.getItem('instance-overview-collapsed:owner@example.de')).toBe('1');
    first.unmount();
    renderWithProviders(<InstanceOverview />);
    expect(screen.queryByTestId('instance-overview-i1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Your instances \(2\)/ }));
    expect(screen.getByTestId('instance-overview-i1')).toBeInTheDocument();
  });

  it('shows just the chip, without header, for a single instance', () => {
    rows = [row({ id: 'i1' })];
    renderWithProviders(<InstanceOverview />);
    expect(screen.getByTestId('instance-overview-i1')).toBeInTheDocument();
    expect(screen.queryByText(/Your instances/)).not.toBeInTheDocument();
  });

  it('keeps the list in a height-limited scroll area for many instances', () => {
    rows = Array.from({ length: 30 }, (_, n) => row({ id: `i${n}`, label: `site${n}.de` }));
    renderWithProviders(<InstanceOverview />);
    expect(screen.getByRole('list').className).toContain('overflow-y-auto');
    expect(screen.getByRole('button', { name: /Your instances \(30\)/ })).toBeInTheDocument();
  });

  it('shows the status and the last approval of each instance', () => {
    rows = [
      row({ id: 'i1', label: 'ukm.de', approval_status: 'DRAFT' }),
      row({
        id: 'i2',
        label: 'ukb.de',
        approval_status: 'APPROVED',
        last_approved_at: '2026-03-01T10:00:00.000Z',
      }),
    ];
    renderWithProviders(<InstanceOverview />);
    expect(screen.getByTestId('instance-overview-i1')).toHaveTextContent('Draft');
    expect(screen.getByTestId('instance-overview-i1')).toHaveAttribute(
      'title',
      expect.stringContaining('Never approved'),
    );
    expect(screen.getByTestId('instance-overview-i2')).toHaveTextContent('Approved');
    expect(screen.getByTestId('instance-overview-i2')).toHaveAttribute(
      'title',
      expect.stringMatching(/Last approved/),
    );
  });

  it('switches the active instance on click', () => {
    rows = [row({ id: 'i1' }), row({ id: 'i2', label: 'ukb.de' })];
    renderWithProviders(<InstanceOverview />);
    fireEvent.click(screen.getByRole('button', { name: 'Open ukb.de' }));
    expect(useCanvasStore.getState().activeInstanceId).toBe('i2');
  });

  it('hides archived instances until the toggle is ticked', async () => {
    rows = [row({ id: 'i1' }), row({ id: 'i2', label: 'old.de', archived_at: '2026-01-01' })];
    renderWithProviders(<InstanceOverview />);
    expect(screen.queryByTestId('instance-overview-i2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Show archived/));
    expect(screen.getByTestId('instance-overview-i2')).toHaveTextContent('Archived');
    fireEvent.click(screen.getByRole('button', { name: /Restore: old.de/ }));
    await waitFor(() => expect(unarchiveInstance).toHaveBeenCalledWith('i2'));
  });

  it('archives after a confirmation that names the published allow list', async () => {
    rows = [row({ id: 'i1' })];
    renderWithProviders(<InstanceOverview />);
    fireEvent.click(screen.getByRole('button', { name: /Archive: ukm.de/ }));
    expect(await screen.findByText(/does not withdraw the site/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(archiveInstance).toHaveBeenCalledWith('i1'));
  });

  it('offers delete only for an instance that was never approved', () => {
    rows = [
      row({ id: 'i1', label: 'fresh.de', approval_status: 'REJECTED' }),
      row({ id: 'i2', label: 'live.de', approval_status: 'DRAFT', last_approved_at: '2026-03-01' }),
      row({ id: 'i3', label: 'wait.de', approval_status: 'PENDING' }),
    ];
    renderWithProviders(<InstanceOverview />);
    expect(screen.getByRole('button', { name: /Delete: fresh.de/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete: live.de/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete: wait.de/ })).not.toBeInTheDocument();
  });

  it('deletes after the dialog names the instance', async () => {
    rows = [row({ id: 'i1', label: 'fresh.de' })];
    renderWithProviders(<InstanceOverview />);
    fireEvent.click(screen.getByRole('button', { name: /Delete: fresh.de/ }));
    expect(await screen.findByText(/permanently deletes fresh.de/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete instance' }));
    await waitFor(() => expect(deleteInstance).toHaveBeenCalledWith('i1', undefined));
  });

  it('explains a refused delete', async () => {
    deleteInstance.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: { code: 'INSTANCE_HAS_HISTORY' } } },
    });
    rows = [row({ id: 'i1', label: 'fresh.de' })];
    renderWithProviders(<InstanceOverview />);
    fireEvent.click(screen.getByRole('button', { name: /Delete: fresh.de/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete instance' }));
    await waitFor(() => expect(deleteInstance).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/permanently deletes/)).not.toBeInTheDocument());
  });

  it('shows an admin only the instances they own', () => {
    me = { email: 'admin@example.de', isAdmin: true };
    rows = [row({ id: 'i1' }), row({ id: 'i2', label: 'foreign.de', is_owner: false })];
    renderWithProviders(<InstanceOverview />);
    expect(screen.getByTestId('instance-overview-i1')).toBeInTheDocument();
    expect(screen.queryByTestId('instance-overview-i2')).not.toBeInTheDocument();
  });

  it('renders nothing without instances', () => {
    rows = [];
    const { container } = renderWithProviders(<InstanceOverview />);
    expect(container.querySelector('section')).toBeNull();
  });
});
