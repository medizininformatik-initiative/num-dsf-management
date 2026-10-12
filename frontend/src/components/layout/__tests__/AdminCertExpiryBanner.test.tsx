/**
 * AdminCertExpiryBanner.test.tsx — the admin certificate warning: thresholds
 * (30 days warning, 7 days danger), silent for non-admins, certificates other
 * than the current one, far-off expiry, and a daily dismissal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';

const useMe = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useMe', () => ({ useMe }));
const mineMock = vi.hoisted(() => vi.fn());
vi.mock('../../../api/adminCertificates.api', () => ({ adminCertificatesApi: { mine: mineMock } }));

import {
  AdminCertExpiryBanner,
  adminCertBannerTone,
  ADMIN_CERT_DISMISS_KEY,
} from '../AdminCertExpiryBanner';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const cert = (days: number, current = true) => ({
  id: 'c1',
  email: 'a@b.de',
  label: null,
  subject: 'cn',
  fingerprint: 'a'.repeat(128),
  validUntil: inDays(days),
  lastUsedAt: null,
  createdAt: inDays(-5),
  createdBy: null,
  current,
});

describe('adminCertBannerTone', () => {
  it.each([
    [31, null],
    [30, 'warning'],
    [8, 'warning'],
    [7, 'danger'],
    [0, 'danger'],
    [-3, 'danger'],
  ])('%i days -> %s', (days, tone) => {
    expect(adminCertBannerTone(days)).toBe(tone);
  });
});

describe('AdminCertExpiryBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    mineMock.mockReset();
    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: true } });
  });

  it('warns 20 days before expiry', async () => {
    mineMock.mockResolvedValue([cert(20)]);
    renderWithProviders(<AdminCertExpiryBanner />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-tone', 'warning');
    expect(alert).toHaveTextContent(/expires in (19|20) days/);
    expect(screen.getByRole('link', { name: 'My admin certificates' })).toHaveAttribute(
      'href',
      '/app/admin/certificates',
    );
  });

  it('turns danger 3 days before expiry', async () => {
    mineMock.mockResolvedValue([cert(3)]);
    renderWithProviders(<AdminCertExpiryBanner />);
    expect(await screen.findByRole('alert')).toHaveAttribute('data-tone', 'danger');
  });

  it('stays silent far from expiry, for other certificates, for non-admins', async () => {
    mineMock.mockResolvedValue([cert(120)]);
    const { unmount } = renderWithProviders(<AdminCertExpiryBanner />);
    await vi.waitFor(() => expect(mineMock).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount();

    mineMock.mockResolvedValue([cert(3, false)]);
    const second = renderWithProviders(<AdminCertExpiryBanner />);
    await vi.waitFor(() => expect(mineMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    second.unmount();

    useMe.mockReturnValue({ data: { email: 'a@b.de', isAdmin: false } });
    renderWithProviders(<AdminCertExpiryBanner />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mineMock).toHaveBeenCalledTimes(2);
  });

  it('can be dismissed for the day and stays hidden on the next render', async () => {
    mineMock.mockResolvedValue([cert(3)]);
    const { unmount } = renderWithProviders(<AdminCertExpiryBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hide until tomorrow' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(localStorage.getItem(ADMIN_CERT_DISMISS_KEY)).toBe(
      new Date().toISOString().slice(0, 10),
    );
    unmount();
    renderWithProviders(<AdminCertExpiryBanner />);
    await vi.waitFor(() => expect(mineMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows again when the dismissal is from an earlier day', async () => {
    localStorage.setItem(ADMIN_CERT_DISMISS_KEY, '2020-01-01');
    mineMock.mockResolvedValue([cert(3)]);
    renderWithProviders(<AdminCertExpiryBanner />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
