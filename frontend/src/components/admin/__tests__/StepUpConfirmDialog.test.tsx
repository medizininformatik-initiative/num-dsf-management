/**
 * StepUpConfirmDialog.test.tsx — the admin step-up confirmation dialog on
 * Modal. Covers the labelled dialog with message, consequence and extra
 * fields; confirm gated on a complete 6-digit code (and on confirmDisabled /
 * pending) in OTP mode and called with the code, submit by Enter; Cancel; and
 * cert mode, where no code field renders and confirm passes undefined.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { useState } from 'react';

const authMode = vi.hoisted(() => ({ cert: false }));
vi.mock('../../../lib/authMode', () => ({
  isCertMode: () => authMode.cert,
  needsTotpStepUp: () => !authMode.cert,
}));

import { StepUpConfirmDialog, type StepUpConfirmDialogProps } from '../StepUpConfirmDialog';

function Harness(props: Partial<StepUpConfirmDialogProps>) {
  const [code, setCode] = useState('');
  return (
    <StepUpConfirmDialog
      open
      title="Lock email"
      subtitle="bob@imi-b.example.de"
      message="The address can no longer sign in."
      consequence="Open sessions end at once."
      confirmLabel="Lock"
      totpCode={code}
      onTotpCodeChange={setCode}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />
  );
}

beforeEach(() => {
  authMode.cert = false;
});

describe('StepUpConfirmDialog', () => {
  it('shows what is decided and gates confirm on a complete code', () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <Harness onConfirm={onConfirm}>
        <label>
          Reason
          <textarea />
        </label>
      </Harness>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Lock email' });
    expect(within(dialog).getByText('bob@imi-b.example.de')).toBeInTheDocument();
    expect(within(dialog).getByText('The address can no longer sign in.')).toBeInTheDocument();
    expect(within(dialog).getByText('Open sessions end at once.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Reason')).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'Lock' });
    expect(confirm).toBeDisabled();
    const code = within(dialog).getByLabelText('TOTP Code');
    fireEvent.change(code, { target: { value: '12a34' } });
    expect(code).toHaveValue('1234');
    expect(confirm).toBeDisabled();

    fireEvent.change(code, { target: { value: '123456' } });
    expect(confirm).toBeEnabled();
    // Enter in the code field submits the form.
    fireEvent.submit(code);
    expect(onConfirm).toHaveBeenCalledWith('123456');
  });

  it('keeps confirm disabled while blocked or pending', () => {
    const { rerender } = renderWithProviders(<Harness confirmDisabled />);
    fireEvent.change(screen.getByLabelText('TOTP Code'), { target: { value: '123456' } });
    expect(screen.getByRole('button', { name: 'Lock' })).toBeDisabled();
    rerender(<Harness pending />);
    expect(screen.getByRole('button', { name: 'Lock' })).toBeDisabled();
  });

  it('cancels', () => {
    const onCancel = vi.fn();
    renderWithProviders(<Harness onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('asks for no code in cert mode and confirms with undefined', () => {
    authMode.cert = true;
    const onConfirm = vi.fn();
    renderWithProviders(<Harness onConfirm={onConfirm} destructive />);
    expect(screen.queryByLabelText('TOTP Code')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });
});
