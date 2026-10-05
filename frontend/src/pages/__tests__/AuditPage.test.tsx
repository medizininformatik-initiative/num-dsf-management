/**
 * AuditPage.test.tsx — cross-instance audit log view.
 * useCrossInstanceAudit and useMe are mocked. The audit hook is driven by the
 * page argument so paging changes which rows it returns, letting the tests
 * assert rows render, pagination pages through, and the loading/empty/error and
 * non-admin-redirect states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { AuditEntry, AuditResponse } from '../../api/audit.api';

const useCrossInstanceAudit = vi.hoisted(() => vi.fn());
const useAuditSites = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useAudit', () => ({ useCrossInstanceAudit, useAuditSites }));

const exportCrossInstanceAudit = vi.hoisted(() => vi.fn());
vi.mock('../../api/audit.api', async (importActual) => ({
  ...(await importActual<typeof import('../../api/audit.api')>()),
  exportCrossInstanceAudit,
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const useMe = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useMe', () => ({ useMe }));

import { AuditPage } from '../AuditPage';

function entry(over: Partial<AuditEntry>): AuditEntry {
  return {
    id: 'e1',
    timestamp: '2026-05-01T10:00:00Z',
    user_email: 'alice@imi.example.de',
    instance_id: 'inst-aaaaaaaa-bbbb',
    resource_type: 'ORGANIZATION',
    resource_id: 'ukm.de',
    operation: 'CREATE',
    diff_json: null,
    ip_address: '10.0.0.1',
    instance_label: 'UKM',
    organization_identifier: 'ukm.de',
    organization_name: 'University Hospital Muenster',
    ...over,
  };
}

function ok(
  rows: AuditEntry[],
  total: number,
): {
  data: AuditResponse;
  isLoading: false;
  error: null;
} {
  return {
    data: { data: rows, meta: { total, page: 1, limit: 50, isAdmin: true } },
    isLoading: false,
    error: null,
  };
}

describe('AuditPage', () => {
  beforeEach(() => {
    useCrossInstanceAudit.mockReset();
    useAuditSites.mockReset();
    exportCrossInstanceAudit.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    useAuditSites.mockReturnValue({ data: [] });
    useMe.mockReturnValue({ data: { email: 'admin@imi.example.de', isAdmin: true } });
  });

  it('renders a table row per audit entry from the mocked hook', () => {
    useCrossInstanceAudit.mockReturnValue(
      ok(
        [
          entry({ id: 'e1', resource_type: 'CONTACT', operation: 'UPDATE' }),
          entry({
            id: 'e2',
            resource_type: 'CERTIFICATE',
            operation: 'DELETE',
            user_email: 'bob@imi.example.de',
            ip_address: '10.0.0.2',
          }),
        ],
        2,
      ),
    );

    renderWithProviders(<AuditPage />);

    expect(screen.getByRole('heading', { name: 'Audit Log' })).toBeInTheDocument();
    // Header columns for resource and operation are present.
    expect(screen.getByRole('columnheader', { name: 'Resource' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Operation' })).toBeInTheDocument();

    // One <tr> per entry in the table body (plus the header row).
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);

    // Cell content from both rows is rendered (the filter dropdowns offer the same
    // labels, so look inside the table).
    // Enum values are shown translated, never raw.
    expect(within(table).getByText('Contact')).toBeInTheDocument();
    expect(within(table).getByText('Certificate')).toBeInTheDocument();
    expect(within(table).getByText('updated')).toBeInTheDocument();
    expect(within(table).getByText('deleted')).toBeInTheDocument();
    expect(within(table).queryByText('UPDATE')).toBeNull();
    expect(screen.getByText('alice@imi.example.de')).toBeInTheDocument();
    expect(screen.getByText('bob@imi.example.de')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.2')).toBeInTheDocument();
  });

  it('pages through with the pagination controls', async () => {
    // 120 entries over a page size of 50 → 3 pages. The hook returns a distinct
    // marker row per page so we can prove the page argument is honoured.
    useCrossInstanceAudit.mockImplementation((page: number) =>
      ok(
        [
          entry({
            id: `p${page}`,
            resource_id: `row-on-page-${page}`,
            user_email: `user${page}@imi.de`,
          }),
        ],
        120,
      ),
    );

    renderWithProviders(<AuditPage />);

    // Page 1 of 3, Previous disabled, page-1 marker visible.
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    const prev = screen.getByRole('button', { name: 'Previous' });
    const next = screen.getByRole('button', { name: 'Next' });
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();
    expect(screen.getByText('user1@imi.de')).toBeInTheDocument();

    // Advance to page 2: marker and counter update, Previous becomes enabled.
    fireEvent.click(next);
    expect(await screen.findByText('user2@imi.de')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
    expect(useCrossInstanceAudit).toHaveBeenCalledWith(2, 50, true, expect.any(Object));

    // Advance to the last page: Next becomes disabled.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('user3@imi.de')).toBeInTheDocument();
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    // Step back down to page 2.
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('user2@imi.de')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('hides pagination controls when a single page of results fits', () => {
    useCrossInstanceAudit.mockReturnValue(ok([entry({ id: 'only' })], 1));

    renderWithProviders(<AuditPage />);

    expect(screen.getByText('alice@imi.example.de')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
  });

  it('shows the loading state while the query is pending', () => {
    useCrossInstanceAudit.mockReturnValue({ data: undefined, isLoading: true, error: null });

    renderWithProviders(<AuditPage />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no entries', () => {
    useCrossInstanceAudit.mockReturnValue(ok([], 0));

    renderWithProviders(<AuditPage />);

    expect(screen.getByText('No audit entries yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the error state when the query fails', () => {
    useCrossInstanceAudit.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
    });

    renderWithProviders(<AuditPage />);

    expect(screen.getByText('Failed to load audit log.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('redirects a non-admin viewer away from the audit page', () => {
    useMe.mockReturnValue({ data: { email: 'viewer@imi.example.de', isAdmin: false } });
    useCrossInstanceAudit.mockReturnValue(ok([], 0));

    renderWithProviders(<AuditPage />);

    // The page redirects (<Navigate to="/app">) so none of its content renders.
    expect(screen.queryByRole('heading', { name: 'Audit Log' })).not.toBeInTheDocument();
    expect(screen.queryByText('No audit entries yet.')).not.toBeInTheDocument();
  });

  describe('anomaly flags', () => {
    const flagged = entry({
      id: 'f1',
      resource_type: 'CERTIFICATE',
      operation: 'DENIED',
      diff_json: { reason: 'PRIVATE_KEY_REJECTED' },
      flags: [{ code: 'PRIVATE_KEY_REJECTED', severity: 'critical' }],
    });

    function withSummary(rows: AuditEntry[]) {
      const res = ok(rows, rows.length);
      res.data.meta.summary = { info: 1, warning: 2, critical: 3, flagged: 6, scanned: 40 };
      return res;
    }

    it('marks a flagged row with an accent, a labelled pill and a readable event', () => {
      useCrossInstanceAudit.mockReturnValue(withSummary([flagged, entry({ id: 'plain' })]));
      renderWithProviders(<AuditPage />);

      const table = screen.getByRole('table');
      const rows = within(table).getAllByRole('row');
      expect(rows[1]).toHaveAttribute('data-flag', 'critical');
      expect(rows[2]).not.toHaveAttribute('data-flag');
      // Text, not colour alone.
      expect(within(rows[1]).getByText('Private key submitted')).toBeInTheDocument();
      expect(
        within(rows[1]).getByText('Certificate upload refused: it contained a private key'),
      ).toBeInTheDocument();
    });

    it('shows the severity counts of the current filter', () => {
      useCrossInstanceAudit.mockReturnValue(withSummary([flagged]));
      renderWithProviders(<AuditPage />);

      const bar = screen.getByRole('region', { name: 'Anomalies' });
      expect(within(bar).getByText('Critical: 3')).toBeInTheDocument();
      expect(within(bar).getByText('Warning: 2')).toBeInTheDocument();
      expect(within(bar).getByText('Notice: 1')).toBeInTheDocument();
    });

    it('says so when nothing is flagged', () => {
      const res = ok([entry({ id: 'plain' })], 1);
      res.data.meta.summary = { info: 0, warning: 0, critical: 0, flagged: 0, scanned: 12 };
      useCrossInstanceAudit.mockReturnValue(res);
      renderWithProviders(<AuditPage />);
      expect(
        screen.getByText('No anomalies among the newest 12 matching entries.'),
      ).toBeInTheDocument();
    });

    it('expands a row to explain the rule and list the recorded fields', () => {
      useCrossInstanceAudit.mockReturnValue(withSummary([flagged]));
      renderWithProviders(<AuditPage />);

      const toggle = screen.getByRole('button', { name: 'Show details' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(toggle);

      expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(screen.getByText('Why this is flagged')).toBeInTheDocument();
      expect(screen.getByText(/never stored or logged/)).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Field' })).toBeInTheDocument();
      expect(screen.getByText('PRIVATE_KEY_REJECTED', { selector: 'td' })).toBeInTheDocument();
    });

    it('shows a before/after table for an update', () => {
      useCrossInstanceAudit.mockReturnValue(
        ok(
          [
            entry({
              id: 'u1',
              operation: 'UPDATE',
              diff_json: { before: { name: 'Old name' }, after: { name: 'New name' } },
            }),
          ],
          1,
        ),
      );
      renderWithProviders(<AuditPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
      expect(screen.getByRole('columnheader', { name: 'Before' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'After' })).toBeInTheDocument();
      expect(screen.getByText('Old name')).toBeInTheDocument();
      expect(screen.getByText('New name')).toBeInTheDocument();
    });
  });

  describe('filters', () => {
    it('applies a changed filter to the query and resets to page one', async () => {
      useCrossInstanceAudit.mockReturnValue(ok([entry({ id: 'x' })], 1));
      renderWithProviders(<AuditPage />);

      fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'DELETE' } });
      fireEvent.change(screen.getByLabelText('User'), { target: { value: 'alice' } });
      fireEvent.click(screen.getByLabelText('Anomalies only'));

      await waitFor(() =>
        expect(useCrossInstanceAudit).toHaveBeenLastCalledWith(
          1,
          50,
          true,
          expect.objectContaining({ operation: 'DELETE', actor: 'alice', flaggedOnly: true }),
        ),
      );
    });

    it('converts the picked days to the start and end of the local day', async () => {
      useCrossInstanceAudit.mockReturnValue(ok([entry({ id: 'x' })], 1));
      renderWithProviders(<AuditPage />);

      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-10' } });
      fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-11' } });

      await waitFor(() => {
        const filters = useCrossInstanceAudit.mock.lastCall?.[3] as { from?: string; to?: string };
        expect(filters.from).toBe(new Date('2026-03-10T00:00:00.000').toISOString());
        expect(filters.to).toBe(new Date('2026-03-11T23:59:59.999').toISOString());
      });
    });

    it('offers the sites and filters by the picked one', async () => {
      useAuditSites.mockReturnValue({
        data: [{ id: 'site-1', label: 'l', org_identifier: 'ukm.de', org_name: 'UKM' }],
      });
      useCrossInstanceAudit.mockReturnValue(ok([entry({ id: 'x' })], 1));
      renderWithProviders(<AuditPage />);

      fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'site-1' } });
      await waitFor(() =>
        expect(useCrossInstanceAudit).toHaveBeenLastCalledWith(
          1,
          50,
          true,
          expect.objectContaining({ instanceId: 'site-1' }),
        ),
      );
    });

    it('resets all filters and shows the no-match text when a filter matches nothing', async () => {
      useCrossInstanceAudit.mockReturnValue(ok([], 0));
      renderWithProviders(<AuditPage />);
      expect(screen.getByRole('button', { name: 'Reset filters' })).toBeDisabled();

      fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzz' } });
      expect(await screen.findByText('No audit entries found.')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
      expect(screen.getByLabelText('Search')).toHaveValue('');
      expect(await screen.findByText('No audit entries yet.')).toBeInTheDocument();
    });
  });

  describe('export', () => {
    beforeEach(() => {
      vi.stubGlobal('URL', {
        ...URL,
        createObjectURL: vi.fn(() => 'blob:audit'),
        revokeObjectURL: vi.fn(),
      });
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    it('downloads the current filter as CSV', async () => {
      useCrossInstanceAudit.mockReturnValue(ok([entry({ id: 'x' })], 1));
      exportCrossInstanceAudit.mockResolvedValue({
        blob: new Blob(['a']),
        filename: 'audit-all-2026-10-05.csv',
      });
      renderWithProviders(<AuditPage />);

      fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'DELETE' } });
      await waitFor(() =>
        expect(useCrossInstanceAudit).toHaveBeenLastCalledWith(
          1,
          50,
          true,
          expect.objectContaining({ operation: 'DELETE' }),
        ),
      );
      fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Audit log exported.'));
      expect(exportCrossInstanceAudit).toHaveBeenCalledWith(
        'csv',
        expect.objectContaining({ operation: 'DELETE' }),
      );
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    });

    it('exports JSON and reports a failed export', async () => {
      useCrossInstanceAudit.mockReturnValue(ok([entry({ id: 'x' })], 1));
      exportCrossInstanceAudit.mockRejectedValue(new Error('403'));
      renderWithProviders(<AuditPage />);

      fireEvent.click(screen.getByRole('button', { name: /Export JSON/ }));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The export failed.'));
      expect(exportCrossInstanceAudit).toHaveBeenCalledWith('json', expect.any(Object));
      expect(toast.success).not.toHaveBeenCalled();
    });
  });
});
