/**
 * ConfirmDialog.test.tsx — the promise-based useConfirm() flow through
 * ConfirmProvider: the alertdialog shows title, message and consequence, starts
 * focus on Cancel and resolves true on confirm, false on Cancel or Escape. A
 * destructive request uses the error-coloured confirm button, and calling
 * useConfirm() without a provider rejects instead of silently resolving.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../ConfirmDialog';
import { useConfirm, type ConfirmOptions } from '../../../hooks/useConfirm';
import { useI18n } from '../../../stores/i18n.store';

const OPTIONS: ConfirmOptions = {
  title: 'Delete endpoint?',
  message: 'fhir.example.de will be removed from the allow list.',
  consequence: 'This cannot be undone.',
  confirmLabel: 'Delete',
  destructive: true,
};

function Trigger({
  onResult,
  onError,
}: {
  onResult: (ok: boolean) => void;
  onError?: (e: unknown) => void;
}) {
  const confirm = useConfirm();
  return (
    <button type="button" onClick={() => confirm(OPTIONS).then(onResult, onError)}>
      Remove
    </button>
  );
}

function setup() {
  useI18n.getState().setLang('en');
  const onResult = vi.fn();
  render(
    <ConfirmProvider>
      <Trigger onResult={onResult} />
    </ConfirmProvider>,
  );
  return { onResult, user: userEvent.setup() };
}

describe('useConfirm', () => {
  it('shows the request and focuses Cancel', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete endpoint?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/will be removed from the allow list/);
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-destructive');
  });

  it('resolves true when confirmed', async () => {
    const { onResult, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('resolves false when cancelled', async () => {
    const { onResult, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('resolves false on Escape and returns focus to the trigger', async () => {
    const { onResult, user } = setup();
    const trigger = screen.getByRole('button', { name: 'Remove' });
    await user.click(trigger);
    await screen.findByRole('alertdialog');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(trigger).toHaveFocus();
  });

  it('rejects when no ConfirmProvider is mounted', async () => {
    const onResult = vi.fn();
    const onError = vi.fn();
    render(<Trigger onResult={onResult} onError={onError} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
    expect(onResult).not.toHaveBeenCalled();
  });
});
