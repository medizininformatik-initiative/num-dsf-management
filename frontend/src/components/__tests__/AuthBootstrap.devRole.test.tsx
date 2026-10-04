/**
 * AuthBootstrap.devRole.test.tsx — the dev-only ?devRole= shortcut must be
 * deterministic: case-insensitive, one login even under StrictMode's double
 * effect, 'me' seeded before the app mounts, param stripped after success, one
 * retry on a transient failure, and a visible error (not a silent login page)
 * when it finally fails. Also covers the refresh retry on a 429.
 */
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth.store';
import { useI18n } from '../../stores/i18n.store';

const refresh = vi.hoisted(() => vi.fn());
const devLogin = vi.hoisted(() => vi.fn());
const getMe = vi.hoisted(() => vi.fn());
vi.mock('../../api/auth.api', () => ({ authApi: { refresh, devLogin, getMe } }));

const toast = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('jwt-decode', () => ({
  jwtDecode: () => ({ sub: 'user-1', email: 'admin@dsf.example.de' }),
}));

import { AuthBootstrap, normalizeDevRole } from '../AuthBootstrap';

const ok = { data: { data: { accessToken: 'tok' } } };

function setUrl(search: string) {
  window.history.replaceState(null, '', `/${search}`);
}

function renderBootstrap(client = new QueryClient()) {
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <AuthBootstrap>
          <div data-testid="app">app</div>
        </AuthBootstrap>
      </QueryClientProvider>
    </StrictMode>,
  );
  return client;
}

describe('normalizeDevRole', () => {
  it('is case-insensitive and rejects unknown roles', () => {
    expect(normalizeDevRole('Admin')).toBe('admin');
    expect(normalizeDevRole(' MEMBER ')).toBe('member');
    expect(normalizeDevRole('site')).toBe('site');
    expect(normalizeDevRole('root')).toBeNull();
    expect(normalizeDevRole(null)).toBeNull();
  });
});

describe('AuthBootstrap ?devRole=', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockReset();
    devLogin.mockReset();
    getMe.mockReset();
    toast.error.mockReset();
    getMe.mockResolvedValue({ data: { data: { email: 'admin@dsf.example.de', isAdmin: true } } });
    useAuthStore.getState().clearAuth();
    useI18n.getState().setLang('en');
  });
  afterEach(() => {
    vi.useRealTimers();
    setUrl('');
  });

  it('logs in once under StrictMode, seeds me, strips the param', async () => {
    setUrl('?devRole=Admin');
    devLogin.mockResolvedValue(ok);
    const client = renderBootstrap();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(devLogin).toHaveBeenCalledTimes(1);
    expect(devLogin).toHaveBeenCalledWith('admin');
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId('app')).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(client.getQueryData(['me'])).toEqual({
      email: 'admin@dsf.example.de',
      isAdmin: true,
    });
    expect(window.location.search).toBe('');
  });

  it('retries once on a transient failure and then succeeds', async () => {
    setUrl('?devRole=member');
    devLogin.mockRejectedValueOnce({ response: { status: 429 } }).mockResolvedValueOnce(ok);
    renderBootstrap();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(devLogin).toHaveBeenCalledTimes(2);
    expect(devLogin).toHaveBeenLastCalledWith('member');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows an error toast, not a silent login page, when both attempts fail', async () => {
    setUrl('?devRole=admin');
    devLogin.mockRejectedValue({ response: { status: 429 } });
    renderBootstrap();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(devLogin).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Dev login failed'),
      expect.objectContaining({ id: 'dev-login-failed' }),
    );
    expect(screen.getByTestId('app')).toBeInTheDocument();
  });
});

describe('AuthBootstrap refresh under throttling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockReset();
    devLogin.mockReset();
    getMe.mockReset();
    useAuthStore.getState().clearAuth();
    setUrl('');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a 429 refresh once (honouring Retry-After) instead of dropping the session', async () => {
    refresh
      .mockRejectedValueOnce({ response: { status: 429, headers: { 'retry-after': '2' } } })
      .mockResolvedValueOnce(ok);
    renderBootstrap();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.queryByTestId('app')).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    // StrictMode's double effect shares one refresh flight, so 2 calls total.
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(screen.getByTestId('app')).toBeInTheDocument();
  });
});
