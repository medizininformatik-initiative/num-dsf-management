/**
 * ExpiryWarningBanner.test.tsx — the banner stays collapsed while nothing is due, grows open
 * (grid rows 0fr → 1fr) once the query reports expiring or expired certificates, words and
 * tones each certificate through certValidity (no negative day counts), ignores certificates
 * certValidity still considers valid, and offers "Renew now".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { ExpiryWarningBanner } from '../ExpiryWarningBanner';
import { useCanvasStore } from '../../../stores/canvas.store';
import { useModals } from '../../../hooks/useModals';

let expiring: { id: string; subject: string; valid_until: string }[] = [];

vi.mock('../../../api/entities.api', () => ({
  api: () => ({
    getExpiringCerts: () => Promise.resolve({ data: { data: expiring } }),
  }),
}));

// Dates relative to "now" so certValidity() is deterministic.
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function wrapper(container: HTMLElement) {
  return container.firstElementChild as HTMLElement;
}

describe('ExpiryWarningBanner', () => {
  beforeEach(() => {
    useCanvasStore.setState({ activeInstanceId: 'i1' });
    useModals.getState().closeModal();
  });

  it('stays collapsed and empty when no certificate is due', async () => {
    expiring = [];
    const { container } = renderWithProviders(<ExpiryWarningBanner />);
    await waitFor(() => expect(wrapper(container)).toHaveAttribute('data-state', 'closed'));
    expect(wrapper(container)).toHaveClass('grid-rows-[0fr]', 'opacity-0');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(container).toHaveTextContent('');
  });

  it('grows open with a height and opacity transition once certificates are due', async () => {
    expiring = [{ id: 'c1', subject: 'CN=ukm.de', valid_until: inDays(60) }];
    const { container } = renderWithProviders(<ExpiryWarningBanner />);
    // Collapsed while the query runs, so the canvas is not pushed down in one jump.
    expect(wrapper(container)).toHaveClass('grid-rows-[0fr]');
    expect(wrapper(container)).toHaveClass('transition-[grid-template-rows,opacity]');

    const banner = await screen.findByRole('region', { name: '1 certificate expiring soon' });
    expect(wrapper(container)).toHaveClass('grid-rows-[1fr]', 'opacity-100', 'duration-medium');
    expect(banner).toHaveClass('bg-warning-surface');
    expect(screen.getByText('CN=ukm.de')).toBeInTheDocument();
    expect(screen.getByText(/^\d+d remaining$/)).toHaveClass('text-warning-fg');
  });

  it('marks certificates that must be renewed now in the danger tone', async () => {
    expiring = [{ id: 'c1', subject: 'CN=ukm.de', valid_until: inDays(10) }];
    renderWithProviders(<ExpiryWarningBanner />);
    const banner = await screen.findByRole('region', { name: /expiring soon/i });
    expect(banner).toHaveClass('bg-danger-surface');
    expect(screen.getByText(/^\d+d remaining$/)).toHaveClass('text-danger-fg');
  });

  it('says how long ago a certificate expired instead of a negative count', async () => {
    expiring = [
      { id: 'c1', subject: 'CN=old.ukm.de', valid_until: inDays(-5) },
      { id: 'c2', subject: 'CN=ukm.de', valid_until: inDays(60) },
    ];
    const { container } = renderWithProviders(<ExpiryWarningBanner />);
    await screen.findByRole('region', { name: 'A certificate has expired' });
    expect(screen.getByText(/^Expired \d+d ago$/)).toHaveClass('text-danger-fg');
    expect(container).not.toHaveTextContent(/-\d+d/);
  });

  it('counts several expired certificates in the title', async () => {
    expiring = [
      { id: 'c1', subject: 'CN=a.ukm.de', valid_until: inDays(-5) },
      { id: 'c2', subject: 'CN=b.ukm.de', valid_until: inDays(-40) },
    ];
    renderWithProviders(<ExpiryWarningBanner />, { lang: 'de' });
    expect(
      await screen.findByRole('region', { name: '2 Zertifikate sind abgelaufen' }),
    ).toBeInTheDocument();
  });

  it('ignores a certificate that certValidity still considers valid', async () => {
    expiring = [{ id: 'c1', subject: 'CN=ukm.de', valid_until: inDays(95) }];
    const { container } = renderWithProviders(<ExpiryWarningBanner />);
    await waitFor(() => expect(wrapper(container)).toHaveAttribute('data-state', 'closed'));
    expect(screen.queryByText('CN=ukm.de')).not.toBeInTheDocument();
  });

  it('opens the renewal dialog from "Renew now"', async () => {
    expiring = [{ id: 'c1', subject: 'CN=ukm.de', valid_until: inDays(10) }];
    renderWithProviders(<ExpiryWarningBanner />);
    await userEvent.click(await screen.findByRole('button', { name: 'Renew now' }));
    expect(useModals.getState().open).toBe('cert-renew');
  });
});
