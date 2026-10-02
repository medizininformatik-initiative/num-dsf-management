/**
 * CertificateFingerprint.test.tsx — the fingerprint is shown in full in 4-character groups;
 * copying writes the raw lower-case hex, confirms with a toast and shows a check on the
 * button for 1.5 s; a refused clipboard write shows an error toast and no check. sonner is
 * mocked to assert the toasts; user-event's clipboard stub records what was written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';

const success = vi.hoisted(() => vi.fn());
const error = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success, error } }));

import { CertificateFingerprint, COPIED_FEEDBACK_MS } from '../CertificateFingerprint';

const HEX = '0123456789abcdef'.repeat(8);

function renderFingerprint(hex = HEX) {
  return renderWithProviders(
    <CertificateFingerprint
      label="DSF fingerprint (SHA-512)"
      hex={hex}
      copyLabel="Copy DSF fingerprint"
      copiedMessage="Copied."
    />,
  );
}

describe('CertificateFingerprint', () => {
  beforeEach(() => {
    success.mockReset();
    error.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the whole fingerprint in groups of four characters', () => {
    renderFingerprint();
    const group = screen.getByRole('group', { name: 'DSF fingerprint (SHA-512)' });
    const code = group.querySelector('code') as HTMLElement;
    const groups = Array.from(code.children).map((el) => el.textContent);
    expect(groups).toHaveLength(32);
    expect(groups.every((g) => g?.length === 4)).toBe(true);
    // No separators in the text, so selecting the block copies the raw value.
    expect(code.textContent).toBe(HEX);
  });

  it('copies the raw hex, confirms with a toast and shows a check for 1.5 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderFingerprint();
    const button = screen.getByRole('button', { name: 'Copy DSF fingerprint' });

    await user.click(button);

    await expect(navigator.clipboard.readText()).resolves.toBe(HEX);
    expect(success).toHaveBeenCalledWith('Copied.');
    expect(button).toHaveAttribute('data-copied', 'true');
    act(() => {
      vi.advanceTimersByTime(COPIED_FEEDBACK_MS);
    });
    expect(button).toHaveAttribute('data-copied', 'false');
  });

  it('displays and copies a separated upper-case fingerprint as lower-case hex', async () => {
    const user = userEvent.setup();
    renderFingerprint('AB:CD:EF:01');
    expect(screen.getByText('abcd')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy DSF fingerprint' }));

    await expect(navigator.clipboard.readText()).resolves.toBe('abcdef01');
  });

  it('shows an error toast when the clipboard refuses the write', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    renderFingerprint();
    const button = screen.getByRole('button', { name: 'Copy DSF fingerprint' });

    await user.click(button);

    expect(error).toHaveBeenCalledWith('Could not copy to the clipboard.');
    expect(success).not.toHaveBeenCalled();
    expect(button).toHaveAttribute('data-copied', 'false');
  });
});
