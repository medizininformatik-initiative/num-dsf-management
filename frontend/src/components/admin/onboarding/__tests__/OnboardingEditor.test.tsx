/**
 * OnboardingEditor.test.tsx – the in-tool spreadsheet editor: inline cell
 * validation (shown after blur), paste of tab-separated rows from Excel, adding
 * and removing rows, and the server dry-run status column.
 */
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingEditor } from '../OnboardingEditor';
import { newEditorRow, type EditorRow } from '../onboardingColumns';
import { useI18n } from '../../../../stores/i18n.store';

const FP = 'a'.repeat(128);

function Harness({ initial, showAllErrors }: { initial?: EditorRow[]; showAllErrors?: boolean }) {
  const [rows, setRows] = useState<EditorRow[]>(initial ?? [newEditorRow()]);
  return (
    <>
      <OnboardingEditor
        rows={rows}
        onChange={setRows}
        showAllErrors={showAllErrors}
        serverStatus={{ 0: { tone: 'success', text: 'Will be created' } }}
      />
      <output data-testid="dump">{JSON.stringify(rows.map((r) => r.cells))}</output>
    </>
  );
}

const dump = () => JSON.parse(screen.getByTestId('dump').textContent ?? '[]');

describe('OnboardingEditor', () => {
  it('marks an invalid cell after blur and describes the problem', async () => {
    useI18n.getState().setLang('en');
    const user = userEvent.setup();
    render(<Harness />);
    const id = screen.getByTestId('cell-0-organizationIdentifier');
    await user.type(id, 'klinik');
    expect(id).not.toHaveAttribute('aria-invalid');
    await user.tab();
    expect(id).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('row-error-0')).toHaveTextContent('Must be a valid FQDN');
  });

  it('shows no error for an untouched blank row, even with showAllErrors', () => {
    useI18n.getState().setLang('en');
    render(<Harness showAllErrors />);
    expect(screen.queryByTestId('row-error-0')).not.toBeInTheDocument();
    // Falls through to the server status.
    expect(screen.getByText('Will be created')).toBeInTheDocument();
  });

  it('pastes tab-separated rows across cells and appends rows as needed', () => {
    useI18n.getState().setLang('en');
    render(<Harness />);
    const text = [
      'organizationIdentifier\torganizationName\tcontactEmail\tclientCertFingerprint',
      `a.example.de\tOrg A\ta@a.example.de\t${FP}`,
      `b.example.de\tOrg B\tb@b.example.de\t${FP}`,
    ].join('\r\n');
    fireEvent.paste(screen.getByTestId('cell-0-organizationIdentifier'), {
      clipboardData: { getData: () => text },
    });
    const rows = dump();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      organizationIdentifier: 'a.example.de',
      organizationName: 'Org A',
    });
    expect(rows[1].clientCertFingerprint).toBe(FP);
    expect(screen.getAllByTestId('onboarding-row')).toHaveLength(2);
  });

  it('keeps the default behaviour when pasting a single value', () => {
    useI18n.getState().setLang('en');
    render(<Harness />);
    const notPrevented = fireEvent.paste(screen.getByTestId('cell-0-city'), {
      clipboardData: { getData: () => 'Muenster' },
    });
    expect(notPrevented).toBe(true);
  });

  it('adds a row and focuses its first cell, and removes a row', async () => {
    useI18n.getState().setLang('en');
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByTestId('onboarding-add-row'));
    expect(screen.getAllByTestId('onboarding-row')).toHaveLength(2);
    expect(screen.getByTestId('cell-1-organizationIdentifier')).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Remove row 1' }));
    await waitFor(() => expect(screen.getAllByTestId('onboarding-row')).toHaveLength(1));
  });
});
