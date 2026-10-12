/**
 * AdminCertificatesPage.test.tsx — "My admin certificates": the list with
 * expiry pills and the current marker, removing the current certificate is
 * disabled, removing another needs the step-up code, adding a successor shows
 * the server preview first and sends PEM, label and code, a private key is
 * flagged and never sent for preview.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';

const useMe = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useMe', () => ({ useMe }));
const api = vi.hoisted(() => ({
  mine: vi.fn(),
  preview: vi.fn(),
  addMine: vi.fn(),
  removeMine: vi.fn(),
  setLabel: vi.fn(),
}));
vi.mock('../../api/adminCertificates.api', () => ({ adminCertificatesApi: api }));

import { AdminCertificatesPage } from '../AdminCertificatesPage';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const row = (id: string, extra = {}) => ({
  id,
  email: 'me@imi.example.de',
  label: null,
  subject: `cn-${id}`,
  fingerprint: id.repeat(128).slice(0, 128),
  validUntil: inDays(200),
  lastUsedAt: null,
  createdAt: inDays(-10),
  createdBy: 'bootstrap',
  current: false,
  ...extra,
});

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

describe('AdminCertificatesPage', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    useMe.mockReturnValue({ data: { email: 'me@imi.example.de', isAdmin: true } });
    api.mine.mockResolvedValue([
      row('a', { current: true, validUntil: inDays(5), label: 'Laptop' }),
      row('b'),
    ]);
    api.removeMine.mockResolvedValue({});
    api.addMine.mockResolvedValue({ data: {} });
    api.preview.mockResolvedValue({
      subject: 'new-admin',
      issuerDn: 'CN=Test CA',
      validFrom: inDays(-1),
      validUntil: inDays(400),
      thumbprintSha512: 'ab'.repeat(64),
      issuerTrusted: true,
      issuerBlacklisted: false,
      whitelistEnforced: false,
    });
  });

  it('lists certificates, marks the current one and disables its removal', async () => {
    renderWithProviders(<AdminCertificatesPage />);
    expect(await screen.findByText('Laptop')).toBeInTheDocument();
    expect(screen.getByText('In use now')).toBeInTheDocument();
    const removes = screen.getAllByRole('button', { name: 'Remove' });
    expect(removes).toHaveLength(2);
    expect(removes[0]).toBeDisabled();
    expect(removes[1]).toBeEnabled();
  });

  it('removes a non-current certificate with the step-up code', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminCertificatesPage />);
    await screen.findByText('Laptop');
    await user.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Remove' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByPlaceholderText('000000'), {
      target: { value: '123456' },
    });
    await user.click(confirm);
    await waitFor(() => expect(api.removeMine).toHaveBeenCalledWith('b', '123456'));
  });

  it('shows the preview and registers a successor with label and code', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminCertificatesPage />);
    await screen.findByText('Laptop');
    await user.click(screen.getByRole('button', { name: 'Register successor certificate' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Register certificate' });
    expect(submit).toBeDisabled();

    fireEvent.change(within(dialog).getByRole('textbox', { name: /certificate/i }), {
      target: { value: PEM },
    });
    expect(await within(dialog).findByText('new-admin', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(api.preview).toHaveBeenCalledWith(PEM);

    fireEvent.change(within(dialog).getByLabelText('Label (optional)'), {
      target: { value: 'Nachfolger' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('000000'), {
      target: { value: '654321' },
    });
    await user.click(submit);
    await waitFor(() => expect(api.addMine).toHaveBeenCalledWith(PEM, 'Nachfolger', '654321'));
  });

  it('flags a private key and never asks the server about it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminCertificatesPage />);
    await screen.findByText('Laptop');
    await user.click(screen.getByRole('button', { name: 'Register successor certificate' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /certificate/i }), {
      target: { value: `${PEM}\n-----BEGIN PRIVATE${' '}KEY-----\nAA\n-----END PRIVATE KEY-----` },
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/private key/i);
    expect(within(dialog).getByRole('button', { name: 'Register certificate' })).toBeDisabled();
    expect(api.preview).not.toHaveBeenCalled();
  });

  it('redirects a non-admin away', () => {
    useMe.mockReturnValue({ data: { email: 'x@y.de', isAdmin: false } });
    renderWithProviders(<AdminCertificatesPage />);
    expect(
      screen.queryByRole('heading', { name: 'My admin certificates' }),
    ).not.toBeInTheDocument();
  });
});
