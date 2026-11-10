/**
 * SecurityPage.test.tsx — the admin's security page and the low-TAN banner:
 * the remaining TANs are shown with a warning from 3 down; a new TAN list
 * needs the step-up code (or a TAN) and is then shown once; a re-setup first
 * asks for the current code. useMe and meTotpApi are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { useAuthStore } from '../../stores/auth.store';

const { status, regenerateTans, setup } = vi.hoisted(() => ({
  status: vi.fn(),
  regenerateTans: vi.fn(),
  setup: vi.fn(),
}));
vi.mock('../../api/meTotp.api', () => ({
  meTotpApi: { status, regenerateTans, setup, confirm: vi.fn() },
}));

const me = vi.hoisted(() => ({ data: { email: 'a@imi.example.de', isAdmin: true } }));
vi.mock('../../hooks/useMe', () => ({ useMe: () => ({ data: me.data }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SecurityPage } from '../SecurityPage';
import { TanLowBanner } from '../../components/layout/TanLowBanner';

beforeEach(() => {
  status
    .mockReset()
    .mockResolvedValue({ enabled: true, remainingTans: 7, enrolmentRequired: false });
  regenerateTans.mockReset().mockResolvedValue(['NEW00001', 'NEW00002']);
  setup.mockReset().mockResolvedValue({ qrCodeUrl: 'data:image/png;base64,AAA', secret: 'KEY' });
  me.data = { email: 'a@imi.example.de', isAdmin: true };
  useAuthStore.setState({ isAuthenticated: true });
});

describe('SecurityPage', () => {
  it('shows the remaining TANs without a warning above the threshold', async () => {
    renderWithProviders(<SecurityPage />);
    expect(await screen.findByText('7 TANs left')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('warns at 3 or fewer TANs', async () => {
    status.mockResolvedValue({ enabled: true, remainingTans: 3, enrolmentRequired: false });
    renderWithProviders(<SecurityPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 3 TANs left');
  });

  it('generates a new TAN list after the step-up code and shows it', async () => {
    renderWithProviders(<SecurityPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate new TAN list' }));
    expect(screen.getByText('The old TAN list stops working at once.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('TOTP Code'), { target: { value: '123456' } });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.textContent === 'Generate new TAN list',
      )!,
    );
    await waitFor(() => expect(regenerateTans).toHaveBeenCalledWith('123456'));
    expect(await screen.findByText('NEW00001')).toBeInTheDocument();
  });

  it('accepts a TAN in the step-up dialog', async () => {
    renderWithProviders(<SecurityPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate new TAN list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use a TAN instead' }));
    fireEvent.change(screen.getByLabelText('TAN'), { target: { value: 'a1b2c3d4' } });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.textContent === 'Generate new TAN list',
      )!,
    );
    await waitFor(() => expect(regenerateTans).toHaveBeenCalledWith('A1B2C3D4'));
  });

  it('asks for the current code before a new authenticator app is set up', async () => {
    renderWithProviders(<SecurityPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up a new authenticator app' }));
    fireEvent.change(screen.getByLabelText('TOTP Code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(setup).toHaveBeenCalledWith('654321'));
    expect(await screen.findByText('KEY')).toBeInTheDocument();
  });

  it('tells a non-admin that only administrators use an authenticator app', async () => {
    me.data = { email: 'm@imi.example.de', isAdmin: false };
    renderWithProviders(<SecurityPage />);
    expect(
      await screen.findByText(/Only administrators use an authenticator app/),
    ).toBeInTheDocument();
  });
});

describe('TanLowBanner', () => {
  it('shows for an admin with 3 or fewer TANs and links to the security page', async () => {
    status.mockResolvedValue({ enabled: true, remainingTans: 2, enrolmentRequired: false });
    renderWithProviders(<TanLowBanner />, { route: '/app' });
    expect(
      await screen.findByText('Only 2 TANs left. Generate a new list soon.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open security settings' })).toHaveAttribute(
      'href',
      '/app/security',
    );
  });

  it('stays hidden with more than 3 TANs', async () => {
    renderWithProviders(<TanLowBanner />, { route: '/app' });
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stays hidden for a non-admin', async () => {
    me.data = { email: 'm@imi.example.de', isAdmin: false };
    status.mockResolvedValue({ enabled: true, remainingTans: 1, enrolmentRequired: false });
    renderWithProviders(<TanLowBanner />, { route: '/app' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
