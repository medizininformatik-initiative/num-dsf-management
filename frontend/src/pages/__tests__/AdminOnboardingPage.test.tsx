/**
 * AdminOnboardingPage.test.tsx — bulk onboarding CSV/JSON import. useMe is
 * mocked to an admin viewer and useOnboardingImport's mutateAsync is mocked;
 * asserts file selection enables Import, mutateAsync receives the File, and a
 * mocked success result renders the summary line and per-row results.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { OnboardingImportResult } from '../../api/onboarding.api';

const useMe = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useMe', () => ({ useMe }));

const { mutateAsyncMock } = vi.hoisted(() => ({ mutateAsyncMock: vi.fn() }));
vi.mock('../../hooks/useOnboardingImport', () => ({
  useOnboardingImport: () => ({ mutateAsync: mutateAsyncMock, isPending: false }),
}));

import { AdminOnboardingPage } from '../AdminOnboardingPage';

function makeFile() {
  return new File(['organizationIdentifier\nukm.de'], 'sites.csv', { type: 'text/csv' });
}

describe('AdminOnboardingPage', () => {
  beforeEach(() => {
    mutateAsyncMock.mockReset();
    useMe.mockReturnValue({ data: { email: 'admin@imi.example.de', isAdmin: true } });
  });

  it('renders the title and disables Import until a file is chosen', () => {
    renderWithProviders(<AdminOnboardingPage />);
    expect(screen.getByRole('heading', { name: 'Bulk Onboarding Import' })).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-import-btn')).toBeDisabled();
  });

  it('selecting a file and clicking Import calls mutateAsync with the File', async () => {
    const user = userEvent.setup();
    mutateAsyncMock.mockResolvedValue({
      summary: { created: 1, updated: 0, failed: 0 },
      rows: [{ identifier: 'ukm.de', action: 'created', ok: true }],
      parseErrors: [],
    } satisfies OnboardingImportResult);
    renderWithProviders(<AdminOnboardingPage />);

    const file = makeFile();
    await user.upload(screen.getByTestId('onboarding-file-input'), file);

    const importBtn = screen.getByTestId('onboarding-import-btn');
    expect(importBtn).not.toBeDisabled();
    await user.click(importBtn);

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledWith(file));
  });

  it('shows the summary counts and per-row results after a successful import', async () => {
    const user = userEvent.setup();
    mutateAsyncMock.mockResolvedValue({
      summary: { created: 1, updated: 2, failed: 1 },
      rows: [
        { identifier: 'ukm.de', action: 'created', ok: true },
        { identifier: 'bad.de', action: 'failed', ok: false, issue: 'invalid fingerprint' },
      ],
      parseErrors: [{ row: 3, issue: 'missing organizationIdentifier' }],
    } satisfies OnboardingImportResult);
    renderWithProviders(<AdminOnboardingPage />);

    await user.upload(screen.getByTestId('onboarding-file-input'), makeFile());
    await user.click(screen.getByTestId('onboarding-import-btn'));

    expect(await screen.findByText('1 created, 2 updated, 1 failed')).toBeInTheDocument();
    expect(screen.getByText('ukm.de')).toBeInTheDocument();
    expect(screen.getByText('bad.de')).toBeInTheDocument();
    // Translated status pills instead of unlabeled English icons.
    const okRow = screen.getByText('ukm.de').closest('tr') as HTMLTableRowElement;
    const badRow = screen.getByText('bad.de').closest('tr') as HTMLTableRowElement;
    expect(within(okRow).getByText('OK')).toBeInTheDocument();
    expect(within(badRow).getAllByText('Failed')).toHaveLength(2);
    expect(screen.getByText('invalid fingerprint')).toBeInTheDocument();
    expect(screen.getByText(/missing organizationIdentifier/)).toBeInTheDocument();
  });
});
