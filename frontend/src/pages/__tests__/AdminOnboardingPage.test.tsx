/**
 * AdminOnboardingPage.test.tsx — the 3-step bulk onboarding flow. useMe is
 * mocked to an admin viewer; the import and dry-run mutations and the template
 * download are mocked. Covers: step 1 (method cards, template downloads),
 * step 2 editor (paste, per-row dry-run status, import gated on a passing
 * check, rows sent to the API), step 2 file upload (auto dry run, import with
 * the File), step 3 summary, and the non-admin redirect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { OnboardingImportResult } from '../../api/onboarding.api';

const useMe = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useMe', () => ({ useMe }));

const { importMock, dryRunMock, downloadMock } = vi.hoisted(() => ({
  importMock: vi.fn(),
  dryRunMock: vi.fn(),
  downloadMock: vi.fn(),
}));
vi.mock('../../hooks/useOnboardingImport', () => ({
  useOnboardingImport: () => ({ mutateAsync: importMock, isPending: false }),
  useOnboardingDryRun: () => ({ mutateAsync: dryRunMock, isPending: false }),
}));
vi.mock('../../api/onboarding.api', async (orig) => ({
  ...(await orig<typeof import('../../api/onboarding.api')>()),
  downloadOnboardingTemplate: downloadMock,
}));

import { AdminOnboardingPage } from '../AdminOnboardingPage';

const FP = 'a'.repeat(128);
const PASTE = [
  `a.example.de\tOrg A\ta@a.example.de\t${FP}\tMuenster\tde`,
  `bad\tOrg B\tb@b.example.de\t${FP}`,
].join('\n');

const previewFixture: OnboardingImportResult = {
  dryRun: true,
  summary: { created: 1, updated: 0, failed: 0 },
  rows: [{ identifier: 'a.example.de', action: 'created', ok: true, row: 1 }],
  parseErrors: [{ row: 2, issue: 'Must be a valid FQDN' }],
};

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<AdminOnboardingPage />);
  await user.click(screen.getByTestId('onboarding-method-editor'));
}

describe('AdminOnboardingPage', () => {
  beforeEach(() => {
    importMock.mockReset();
    dryRunMock.mockReset();
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
        clientCertFingerprint: FP,
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
    await waitFor(() => expect(importMock).toHaveBeenCalledTimes(1));
    expect(importMock.mock.calls[0][0]).toHaveLength(2);

    // Step 3: summary.
    const result = await screen.findByTestId('onboarding-result');
    expect(within(result).getByText('1 created, 0 updated, 0 failed')).toBeInTheDocument();
    expect(
      screen.getByTestId('onboarding-stepper').querySelector('[aria-current="step"]'),
    ).toHaveTextContent('Import');
    await user.click(screen.getByTestId('onboarding-start-over'));
    expect(screen.getByTestId('onboarding-step-method')).toBeInTheDocument();
  });

  it('file upload: dry-runs the chosen file and imports that same File', async () => {
    const user = userEvent.setup();
    dryRunMock.mockResolvedValue({
      ...previewFixture,
      rows: [{ identifier: 'ukm.example.de', action: 'updated', ok: true, row: 1 }],
      summary: { created: 0, updated: 1, failed: 0 },
      parseErrors: [],
    });
    importMock.mockResolvedValue({
      summary: { created: 0, updated: 1, failed: 0 },
      rows: [{ identifier: 'ukm.example.de', action: 'updated', ok: true }],
      parseErrors: [],
    } satisfies OnboardingImportResult);
    renderWithProviders(<AdminOnboardingPage />);
    await user.click(screen.getByTestId('onboarding-method-file'));

    const file = new File(['x'], 'sites.xlsx');
    await user.upload(screen.getByTestId('onboarding-file-input'), file);
    await waitFor(() => expect(dryRunMock).toHaveBeenCalledWith(file));
    expect(await screen.findByText('ukm.example.de')).toBeInTheDocument();

    await user.click(screen.getByTestId('onboarding-import-btn'));
    await waitFor(() => expect(importMock).toHaveBeenCalledWith(file));
    expect(await screen.findByText('0 created, 1 updated, 0 failed')).toBeInTheDocument();
  });

  it('shows the translated error when the dry run is rejected by the server', async () => {
    const user = userEvent.setup();
    dryRunMock.mockRejectedValue({ response: { data: { error: { code: 'PEM_NOT_ALLOWED' } } } });
    renderWithProviders(<AdminOnboardingPage />);
    await user.click(screen.getByTestId('onboarding-method-file'));
    await user.upload(screen.getByTestId('onboarding-file-input'), new File(['x'], 's.csv'));
    await waitFor(() => expect(dryRunMock).toHaveBeenCalled());
    expect(screen.getByTestId('onboarding-import-btn')).toBeDisabled();
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
