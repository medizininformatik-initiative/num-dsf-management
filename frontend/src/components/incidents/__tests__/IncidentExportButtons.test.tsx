/**
 * IncidentExportButtons.test.tsx — the file name from Content-Disposition
 * (plain and UTF-8 forms, else none) and a download per format saved under
 * that name or the incident-<id> fallback. incidents.api and saveBlob are
 * mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';

const { exportMock, saveMock } = vi.hoisted(() => ({ exportMock: vi.fn(), saveMock: vi.fn() }));
vi.mock('../../../api/incidents.api', () => ({ incidentsApi: { export: exportMock } }));
vi.mock('../../../lib/downloadBlob', async (orig) => ({
  ...(await orig<typeof import('../../../lib/downloadBlob')>()),
  saveBlob: saveMock,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { IncidentExportButtons, dispositionFilename } from '../IncidentExportButtons';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dispositionFilename', () => {
  it('reads the plain and the UTF-8 form', () => {
    expect(dispositionFilename('attachment; filename="incident-1.json"')).toBe('incident-1.json');
    expect(dispositionFilename("attachment; filename*=UTF-8''Vorfall%20%C3%BC.csv")).toBe(
      'Vorfall ü.csv',
    );
    expect(dispositionFilename(null)).toBeNull();
  });
});

describe('IncidentExportButtons', () => {
  it('saves the JSON export under the server name', async () => {
    exportMock.mockResolvedValue({
      data: new Blob(['{}']),
      headers: { 'content-disposition': 'attachment; filename="incident-i1-2026-11-10.json"' },
    });
    const user = userEvent.setup();
    renderWithProviders(<IncidentExportButtons incidentId="i1" />);
    await user.click(screen.getByRole('button', { name: 'Export JSON' }));
    await waitFor(() => expect(exportMock).toHaveBeenCalledWith('i1', 'json'));
    expect(saveMock).toHaveBeenCalledWith(expect.any(Blob), 'incident-i1-2026-11-10.json');
  });

  it('falls back to incident-<id>.csv', async () => {
    exportMock.mockResolvedValue({ data: 'seq,at\n', headers: {} });
    const user = userEvent.setup();
    renderWithProviders(<IncidentExportButtons incidentId="i1" />);
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith(expect.any(Blob), 'incident-i1.csv'));
  });
});
