/**
 * AdminOnboardingPage.test.tsx — the 3-step bulk onboarding flow. useMe is
 * mocked to an admin viewer; the import and dry-run mutations and the template
 * download are mocked. Covers: step 1 (method cards, template downloads),
 * step 2 editor (paste, per-row dry-run status, import gated on a passing
 * check, rows sent to the API), step 2 multi-file upload (merge, source column,
 * conflicts across files, per-file rejection, file removal, one check and one
 * import, summary per file), step 3 summary, and the non-admin redirect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { OnboardingImportResult } from '../../api/onboarding.api';

const useMe = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useMe', () => ({ useMe }));

const { importMock, dryRunMock, parseMock, downloadMock } = vi.hoisted(() => ({
  importMock: vi.fn(),
  dryRunMock: vi.fn(),
  parseMock: vi.fn(),
  downloadMock: vi.fn(),
}));
vi.mock('../../hooks/useOnboardingImport', () => ({
  useOnboardingImport: () => ({ mutateAsync: importMock, isPending: false }),
  useOnboardingDryRun: () => ({ mutateAsync: dryRunMock, isPending: false }),
  useOnboardingParse: () => ({ mutateAsync: parseMock, isPending: false }),
}));
vi.mock('../../api/onboarding.api', async (orig) => ({
  ...(await orig<typeof import('../../api/onboarding.api')>()),
  downloadOnboardingTemplate: downloadMock,
}));

import { AdminOnboardingPage } from '../AdminOnboardingPage';

const FP = 'a'.repeat(128);
const FP_C = 'c'.repeat(128);
const PASTE = [
  `a.example.de\tOrg A\ta@a.example.de\t${FP}\tMuenster\tde`,
  `bad\tOrg B\tb@b.example.de\t${FP_C}`,
].join('\n');

const previewFixture: OnboardingImportResult = {
  dryRun: true,
  summary: { created: 1, updated: 0, failed: 0 },
  rows: [{ identifier: 'a.example.de', action: 'created', ok: true, row: 1 }],
  parseErrors: [{ row: 2, issue: 'Must be a valid FQDN' }],
};

/** Confirm the import in the step-up dialog with a TOTP code (OTP session). */
async function confirmImport(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText('TOTP Code'), '123456');
  await user.click(within(dialog).getByRole('button', { name: /Import/ }));
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<AdminOnboardingPage />);
  await user.click(screen.getByTestId('onboarding-method-editor'));
}

describe('AdminOnboardingPage', () => {
  beforeEach(() => {
    importMock.mockReset();
    dryRunMock.mockReset();
    parseMock.mockReset();
    downloadMock.mockReset();
    useMe.mockReturnValue({ data: { email: 'admin@imi.example.de', isAdmin: true } });
  });

  it('starts on step 1 with the two methods and both template downloads', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOnboardingPage />);
    expect(screen.getByRole('heading', { name: 'Bulk Onboarding Import' })).toBeInTheDocument();
    expect(
      screen.getByTestId('onboarding-stepper').querySelector('[aria-current="step"]'),
    ).toHaveTextContent('Choose method');
    await user.click(screen.getByTestId('onboarding-template-xlsx'));
    expect(downloadMock).toHaveBeenCalledWith('xlsx');
    await user.click(screen.getByTestId('onboarding-template-csv'));
    expect(downloadMock).toHaveBeenCalledWith('csv');
  });

  it('redirects non-admins away', () => {
    useMe.mockReturnValue({ data: { email: 'u@example.de', isAdmin: false } });
    renderWithProviders(<AdminOnboardingPage />);
    expect(screen.queryByTestId('admin-onboarding')).not.toBeInTheDocument();
  });

  it('editor: paste, check against the server, then import the typed rows', async () => {
    const user = userEvent.setup();
    dryRunMock.mockResolvedValue(previewFixture);
    importMock.mockResolvedValue({
      summary: { created: 1, updated: 0, failed: 0 },
      rows: [{ identifier: 'a.example.de', action: 'created', ok: true, row: 1 }],
      parseErrors: [],
    } satisfies OnboardingImportResult);
    await openEditor(user);

    // Import is gated on a check.
    expect(screen.getByTestId('onboarding-import-btn')).toBeDisabled();
    fireEvent.paste(screen.getByTestId('cell-0-organizationIdentifier'), {
      clipboardData: { getData: () => PASTE },
    });
    await user.click(screen.getByTestId('onboarding-validate-btn'));

    // Only the two non-blank rows are sent, without empty optional fields.
    await waitFor(() => expect(dryRunMock).toHaveBeenCalledTimes(1));
    expect(dryRunMock.mock.calls[0][0]).toEqual([
      {
        organizationIdentifier: 'a.example.de',
        organizationName: 'Org A',
        contactEmail: 'a@a.example.de',
        clientCertFingerprint: FP,
        city: 'Muenster',
        countryCode: 'de',
      },
      {
        organizationIdentifier: 'bad',
        organizationName: 'Org B',
        contactEmail: 'b@b.example.de',
        clientCertFingerprint: FP_C,
      },
    ]);

    // Per-row results land on the right editor rows.
    expect(await screen.findByText('Will be created')).toBeInTheDocument();
    expect(screen.getByTestId('row-error-1')).toHaveTextContent('Must be a valid FQDN');
    expect(screen.getByTestId('onboarding-preview-note')).toHaveTextContent(
      'Check passed for 1 sites, 1 will be skipped',
    );

    // Editing invalidates the check.
    await user.type(screen.getByTestId('cell-0-city'), 'x');
    expect(screen.getByTestId('onboarding-import-btn')).toBeDisabled();
    await user.click(screen.getByTestId('onboarding-validate-btn'));
    await waitFor(() => expect(screen.getByTestId('onboarding-import-btn')).toBeEnabled());

    await user.click(screen.getByTestId('onboarding-import-btn'));
    expect(importMock).not.toHaveBeenCalled();
    await confirmImport(user);
    await waitFor(() => expect(importMock).toHaveBeenCalledTimes(1));
    expect(importMock.mock.calls[0][0].source).toHaveLength(2);
    expect(importMock.mock.calls[0][0].totpCode).toBe('123456');

    // Step 3: summary.
    const result = await screen.findByTestId('onboarding-result');
    expect(within(result).getByText('1 created, 0 updated, 0 failed')).toBeInTheDocument();
    expect(
      screen.getByTestId('onboarding-stepper').querySelector('[aria-current="step"]'),
    ).toHaveTextContent('Import');
    await user.click(screen.getByTestId('onboarding-start-over'));
    expect(screen.getByTestId('onboarding-step-method')).toBeInTheDocument();
  });

  describe('file upload', () => {
    const FP2 = 'b'.repeat(128);
    const parsedRow = (id: string, fp: string, row = 1) => ({
      organizationIdentifier: id,
      organizationName: `Org ${id}`,
      contactEmail: `dsf@${id}`,
      clientCertFingerprint: fp,
      row,
    });
    const parseByName = (map: Record<string, unknown>) =>
      parseMock.mockImplementation(async (f: File) => {
        const r = map[f.name];
        if (r instanceof Error) throw r;
        return r;
      });
    const upload = (user: ReturnType<typeof userEvent.setup>, names: string[]) =>
      user.upload(
        screen.getByTestId('onboarding-file-input'),
        names.map((n) => new File(['x'], n)),
      );

    async function openUpload(user: ReturnType<typeof userEvent.setup>) {
      renderWithProviders(<AdminOnboardingPage />);
      await user.click(screen.getByTestId('onboarding-method-file'));
    }

    it('merges the rows of several files, checks once and imports once with a summary per file', async () => {
      const user = userEvent.setup();
      parseByName({
        'a.csv': { rows: [parsedRow('a.example.de', FP)], parseErrors: [] },
        'b.xlsx': {
          rows: [parsedRow('b.example.de', FP2)],
          parseErrors: [{ row: 2, issue: 'Must be a valid FQDN' }],
        },
      });
      dryRunMock.mockResolvedValue({
        dryRun: true,
        summary: { created: 1, updated: 1, failed: 0 },
        rows: [
          { identifier: 'a.example.de', action: 'created', ok: true, row: 1 },
          { identifier: 'b.example.de', action: 'updated', ok: true, row: 2 },
        ],
        parseErrors: [],
      } satisfies OnboardingImportResult);
      importMock.mockResolvedValue({
        summary: { created: 1, updated: 0, failed: 1 },
        rows: [
          { identifier: 'a.example.de', action: 'created', ok: true, row: 1 },
          { identifier: 'b.example.de', action: 'failed', ok: false, issue: 'X', row: 2 },
        ],
        parseErrors: [],
      } satisfies OnboardingImportResult);
      await openUpload(user);

      await upload(user, ['a.csv', 'b.xlsx']);
      expect(await screen.findAllByTestId('onboarding-file')).toHaveLength(2);
      await waitFor(() => expect(screen.getAllByTestId('onboarding-row')).toHaveLength(2));
      expect(screen.getByTestId('row-source-0')).toHaveTextContent('a.csv');
      expect(screen.getByTestId('row-source-1')).toHaveTextContent('b.xlsx');
      expect(screen.getByText('1 rows skipped')).toBeInTheDocument();

      await user.click(screen.getByTestId('onboarding-validate-btn'));
      await waitFor(() => expect(dryRunMock).toHaveBeenCalledTimes(1));
      expect(dryRunMock.mock.calls[0][0]).toHaveLength(2);
      await waitFor(() => expect(screen.getByTestId('onboarding-import-btn')).toBeEnabled());
      await user.click(screen.getByTestId('onboarding-import-btn'));
      await confirmImport(user);

      await waitFor(() => expect(importMock).toHaveBeenCalledTimes(1));
      const items = await screen.findAllByTestId('onboarding-file-summary-item');
      expect(items[0]).toHaveTextContent('a.csv');
      expect(items[0]).toHaveTextContent('1 created, 0 updated, 0 failed');
      expect(items[1]).toHaveTextContent('b.xlsx');
      expect(items[1]).toHaveTextContent('0 created, 0 updated, 1 failed');
    });

    it('flags the same identifier in two files on both rows and blocks the import', async () => {
      const user = userEvent.setup();
      parseByName({
        'a.csv': { rows: [parsedRow('same.example.de', FP)], parseErrors: [] },
        'b.csv': { rows: [parsedRow('same.example.de', FP2)], parseErrors: [] },
      });
      dryRunMock.mockResolvedValue(previewFixture);
      await openUpload(user);
      await upload(user, ['a.csv', 'b.csv']);
      await waitFor(() => expect(screen.getAllByTestId('onboarding-row')).toHaveLength(2));
      expect(screen.getByTestId('onboarding-conflicts')).toHaveTextContent('2 rows conflict');
      const rows = screen.getAllByTestId('onboarding-row');
      expect(rows[0]).toHaveTextContent('Same identifier as row 2 (b.csv)');
      expect(rows[1]).toHaveTextContent('Same identifier as row 1 (a.csv)');
      await user.click(screen.getByTestId('onboarding-validate-btn'));
      await waitFor(() => expect(dryRunMock).toHaveBeenCalled());
      expect(screen.getByTestId('onboarding-import-btn')).toBeDisabled();
    });

    it('flags one fingerprint used by two different sites', async () => {
      const user = userEvent.setup();
      parseByName({
        'a.csv': { rows: [parsedRow('a.example.de', FP)], parseErrors: [] },
        'b.csv': { rows: [parsedRow('b.example.de', FP)], parseErrors: [] },
      });
      await openUpload(user);
      await upload(user, ['a.csv', 'b.csv']);
      await waitFor(() => expect(screen.getAllByTestId('onboarding-row')).toHaveLength(2));
      expect(screen.getAllByTestId('onboarding-row')[0]).toHaveTextContent(
        'Same fingerprint as row 2 (b.csv)',
      );
    });

    it('rejects an unsupported type per file without the server, and shows a server rejection', async () => {
      const user = userEvent.setup({ applyAccept: false });
      parseByName({
        'secret.csv': Object.assign(new Error('x'), {
          response: { data: { error: { code: 'PEM_NOT_ALLOWED' } } },
        }),
        'ok.csv': { rows: [parsedRow('ok.example.de', FP)], parseErrors: [] },
      });
      await openUpload(user);
      await upload(user, ['notes.txt', 'secret.csv', 'ok.csv']);
      await waitFor(() => expect(screen.getAllByTestId('onboarding-row')).toHaveLength(1));
      expect(parseMock.mock.calls.map((c) => (c[0] as File).name)).toEqual([
        'secret.csv',
        'ok.csv',
      ]);
      const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
      expect(alerts).toContain('Unsupported file type. Use CSV, XLSX or JSON.');
      expect(alerts).toContain('PEM content is not allowed in this file.');
    });

    it('removing a file drops exactly its rows', async () => {
      const user = userEvent.setup();
      parseByName({
        'a.csv': { rows: [parsedRow('a.example.de', FP)], parseErrors: [] },
        'b.csv': { rows: [parsedRow('b.example.de', FP2)], parseErrors: [] },
      });
      await openUpload(user);
      await upload(user, ['a.csv', 'b.csv']);
      await waitFor(() => expect(screen.getAllByTestId('onboarding-row')).toHaveLength(2));
      await user.click(screen.getByRole('button', { name: 'Remove file a.csv' }));
      await waitFor(() => expect(screen.getAllByTestId('onboarding-file')).toHaveLength(1));
      expect(screen.getAllByTestId('onboarding-row')).toHaveLength(1);
      expect(screen.getByTestId('cell-0-organizationIdentifier')).toHaveValue('b.example.de');
    });
  });

  it('Back returns to step 1 and keeps the typed rows', async () => {
    const user = userEvent.setup();
    await openEditor(user);
    await user.type(screen.getByTestId('cell-0-city'), 'Bonn');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('onboarding-step-method')).toBeInTheDocument();
    await user.click(screen.getByTestId('onboarding-method-editor'));
    expect(screen.getByTestId('cell-0-city')).toHaveValue('Bonn');
  });
});
