/**
 * AdminBackupsPage.test.tsx — the admin backup page. backupsApi is mocked.
 * Covers the run history (status pills, size, copyable checksum, failed-run
 * banner), the schedule form validation (retention bounds), saving with the
 * 6-digit step-up, "back up now" and the download in OTP mode, and a cert mode
 * block where the same actions run without a code field.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { AdminBackupsPage } from '../AdminBackupsPage';
import { formatBytes } from '../../lib/formatBytes';

const m = vi.hoisted(() => ({
  settings: {
    enabled: true,
    mode: 'DAILY' as const,
    dailyTime: '02:30',
    retentionCount: 14,
    updatedBy: null,
    updatedAt: null,
  },
  saveSettings: vi.fn(),
  runNow: vi.fn(),
  download: vi.fn(),
  listRuns: vi.fn(),
  cert: false,
}));

vi.mock('../../api/backups.api', () => ({
  backupsApi: {
    getSettings: vi.fn(() =>
      Promise.resolve({
        data: { data: { settings: m.settings, encryptionEnabled: false, directory: '/backups' } },
      }),
    ),
    saveSettings: m.saveSettings,
    listRuns: m.listRuns,
    runNow: m.runNow,
    download: m.download,
  },
}));

vi.mock('../../lib/authMode', () => ({
  isCertMode: () => m.cert,
  needsTotpStepUp: () => !m.cert,
  reauthRedirect: vi.fn(),
}));

// The typing tests are slow when the whole suite runs on a loaded machine.
vi.setConfig({ testTimeout: 15000 });

const SHA = 'ab12'.repeat(16);
const runs = [
  {
    id: 'r2',
    startedAt: '2026-10-05T01:00:00Z',
    finishedAt: '2026-10-05T01:00:02Z',
    trigger: 'SCHEDULED',
    triggeredBy: null,
    status: 'FAILED',
    fileName: null,
    sizeBytes: null,
    sha256: null,
    encrypted: false,
    durationMs: 2000,
    error: 'ENOSPC: no space left on device',
    fileDeleted: false,
  },
  {
    id: 'r1',
    startedAt: '2026-10-04T01:00:00Z',
    finishedAt: '2026-10-04T01:00:02Z',
    trigger: 'MANUAL',
    triggeredBy: 'admin@imi.example.de',
    status: 'SUCCESS',
    fileName: 'dsf-allowlist-backup-20261004-010000-abcdef12.json.gz',
    sizeBytes: 2_621_440,
    sha256: SHA,
    encrypted: false,
    durationMs: 1500,
    error: null,
    fileDeleted: false,
  },
];

beforeEach(() => {
  m.cert = false;
  m.saveSettings.mockReset().mockResolvedValue({ data: { data: { settings: m.settings } } });
  m.runNow.mockReset().mockResolvedValue({ data: { data: { run: runs[1] } } });
  m.download.mockReset().mockResolvedValue({ data: new Blob(['x']) });
  m.listRuns.mockReset().mockResolvedValue({ data: { data: { runs } } });
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
});

async function typeCode(code: string) {
  const input = await screen.findByLabelText(/authenticator|code/i);
  await userEvent.type(input, code);
}

describe('AdminBackupsPage', () => {
  it('lists runs with status, size and checksum, and flags a failed latest run', async () => {
    renderWithProviders(<AdminBackupsPage />);
    const items = await screen.findAllByTestId('backup-run');
    expect(items).toHaveLength(2);
    expect(await screen.findByTestId('backup-failed-banner')).toHaveTextContent('ENOSPC');
    expect(within(items[1]).getByText('2.5 MB', { exact: false })).toBeInTheDocument();
    expect(within(items[1]).getByText(SHA)).toBeInTheDocument();
    expect(within(items[1]).getByRole('button', { name: /copy checksum/i })).toBeInTheDocument();
  });

  it('formats sizes', () => {
    expect(formatBytes(null)).toBe('-');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2_621_440)).toBe('2.5 MB');
  });

  it('rejects a retention below 7 and does not open the step-up', async () => {
    renderWithProviders(<AdminBackupsPage />);
    const retention = await screen.findByLabelText(/files to keep/i);
    await userEvent.clear(retention);
    await userEvent.type(retention, '3');
    await userEvent.click(screen.getByRole('button', { name: /save schedule/i }));
    expect(
      await within(screen.getByTestId('backup-settings-form')).findByRole('alert'),
    ).toHaveTextContent(/between 7 and 365/i);
    expect(m.saveSettings).not.toHaveBeenCalled();
  });

  it('saves the schedule after the 6-digit step-up', async () => {
    renderWithProviders(<AdminBackupsPage />);
    const retention = await screen.findByLabelText(/files to keep/i);
    await userEvent.clear(retention);
    await userEvent.type(retention, '21');
    await userEvent.click(screen.getByRole('button', { name: /save schedule/i }));
    await typeCode('123456');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /save schedule/i }));
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1));
    expect(m.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ retentionCount: 21, mode: 'DAILY', dailyTime: '02:30' }),
      '123456',
    );
  });

  it('creates a backup now and downloads a stored file with the step-up code', async () => {
    renderWithProviders(<AdminBackupsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /back up now/i }));
    await typeCode('654321');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /back up now/i }));
    await waitFor(() => expect(m.runNow).toHaveBeenCalledWith('654321'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(await screen.findByRole('button', { name: /^download$/i }));
    await typeCode('111222');
    const dl = await screen.findByRole('dialog');
    await userEvent.click(within(dl).getByRole('button', { name: /download/i }));
    await waitFor(() => expect(m.download).toHaveBeenCalledWith('r1', '111222'));
  });

  it('runs actions directly in certificate mode, without a code', async () => {
    m.cert = true;
    renderWithProviders(<AdminBackupsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /back up now/i }));
    await waitFor(() => expect(m.runNow).toHaveBeenCalledWith(undefined));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
