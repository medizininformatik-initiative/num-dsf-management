/**
 * authInterceptor.test.ts — a failed step-up (401 TOTP_INVALID / CERT_STEP_UP_FAILED /
 * TOTP_REQUIRED, 403 TOTP_NOT_CONFIGURED) must neither refresh, retry nor end
 * the session, and is published to the step-up error store; a plain 401 still
 * refreshes and, when the refresh fails, ends the session.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

const { refreshMock, redirectMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  redirectMock: vi.fn(),
}));
vi.mock('../auth.api', () => ({ authApi: { refresh: refreshMock } }));
vi.mock('../../lib/authMode', () => ({ reauthRedirect: redirectMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { installAuthInterceptor } from '../authInterceptor';
import { useAuthStore } from '../../stores/auth.store';
import { useStepUpErrorStore } from '../../stores/stepUpError.store';

let calls = 0;
function failingAdapter(status: number, code?: string) {
  return async (config: AxiosRequestConfig) => {
    calls += 1;
    throw new AxiosError('fail', 'ERR', config as never, null, {
      status,
      statusText: '',
      headers: {},
      config: config as never,
      data: code ? { error: { code, message: code } } : {},
    });
  };
}

beforeAll(() => installAuthInterceptor());
beforeEach(() => {
  calls = 0;
  vi.clearAllMocks();
  useStepUpErrorStore.getState().clear();
  useAuthStore.setState({
    accessToken: 'tok',
    user: { id: 'u', email: 'a@b.de' },
    isAuthenticated: true,
  });
});

describe('auth interceptor and step-up failures', () => {
  it.each([
    [401, 'TOTP_INVALID'],
    [401, 'CERT_STEP_UP_FAILED'],
    [401, 'TOTP_REQUIRED'],
    [403, 'TOTP_NOT_CONFIGURED'],
  ])('keeps the session on %i %s and records the code', async (status, code) => {
    await expect(
      axios.post('/api/v1/admin/x', {}, { adapter: failingAdapter(status, code) as never }),
    ).rejects.toBeDefined();
    expect(calls).toBe(1);
    expect(refreshMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useStepUpErrorStore.getState().code).toBe(code);
  });

  it('still ends the session when a plain 401 cannot be refreshed', async () => {
    refreshMock.mockRejectedValue(new Error('expired'));
    await expect(
      axios.get('/api/v1/instances', { adapter: failingAdapter(401) as never }),
    ).rejects.toBeDefined();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useStepUpErrorStore.getState().code).toBeNull();
  });
});
