/**
 * AdminBundleVersionsPage.test.tsx — admin bundle-version history.
 * bundleVersionsApi is mocked with two version rows and a diff; asserts the
 * title, the version numbers, the date in the app language, and that picking
 * A and B (toggle buttons) shows the diff summary.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';

function row(id: string, version: number) {
  return {
    id,
    version_number: version,
    created_at: '2026-05-01T12:00:00Z',
    triggered_by: 'APPROVAL',
    triggered_by_email: 'admin@example.com',
    content_hash: 'abc',
    notes: null,
    approval_request_id: null,
  };
}

vi.mock('../../api/bundleVersions.api', () => ({
  bundleVersionsApi: {
    list: vi.fn().mockResolvedValue({
      data: {
        data: [row('v1', 7), row('v2', 8)],
        meta: { page: 1, limit: 50, total: 2, pages: 1 },
      },
    }),
    diff: vi.fn().mockResolvedValue({
      data: { data: { added: [{}], removed: [], changed: [{}, {}] } },
    }),
    downloadUrl: (id: string) => `/download/${id}`,
  },
}));

import { AdminBundleVersionsPage } from '../AdminBundleVersionsPage';

describe('AdminBundleVersionsPage', () => {
  it('renders the title and the version rows with dates in the app language', async () => {
    renderWithProviders(<AdminBundleVersionsPage />);
    expect(screen.getByRole('heading', { name: 'Bundle versions' })).toBeInTheDocument();
    expect(await screen.findByText('v7')).toBeInTheDocument();
    expect(screen.getByText('v8')).toBeInTheDocument();
    expect(screen.getAllByText(/1 May 2026/)).toHaveLength(2);
  });

  it('diffs the two picked versions', async () => {
    renderWithProviders(<AdminBundleVersionsPage />);
    const rowA = (await screen.findByText('v7')).closest('tr') as HTMLTableRowElement;
    const rowB = screen.getByText('v8').closest('tr') as HTMLTableRowElement;

    fireEvent.click(within(rowA).getByRole('button', { name: 'Pick A' }));
    expect(within(rowA).getByRole('button', { name: 'Pick A' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(rowB).getByRole('button', { name: 'Pick B' }));

    const card = await screen.findByTestId('bundle-versions-diff');
    expect(await within(card).findByText('Added: 1')).toBeInTheDocument();
    expect(within(card).getByText('Removed: 0')).toBeInTheDocument();
    expect(within(card).getByText('Changed: 2')).toBeInTheDocument();
  });
});
