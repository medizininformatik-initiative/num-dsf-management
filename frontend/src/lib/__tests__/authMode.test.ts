import { describe, it, expect, vi, afterEach } from 'vitest';
import { isCertMode, reauthRedirect, needsTotpStepUp } from '../authMode';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('authMode', () => {
  it('isCertMode is true only when VITE_AUTH_MODE=cert', () => {
    vi.stubEnv('VITE_AUTH_MODE', 'cert');
    expect(isCertMode()).toBe(true);
    vi.stubEnv('VITE_AUTH_MODE', 'otp');
    expect(isCertMode()).toBe(false);
    vi.stubEnv('VITE_AUTH_MODE', '');
    expect(isCertMode()).toBe(false);
  });

  it('reauthRedirect goes to / in cert mode, /login otherwise', () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { replace } as unknown as Location);
    vi.stubEnv('VITE_AUTH_MODE', 'cert');
    reauthRedirect();
    expect(replace).toHaveBeenLastCalledWith('/');
    vi.stubEnv('VITE_AUTH_MODE', 'otp');
    reauthRedirect();
    expect(replace).toHaveBeenLastCalledWith('/login');
  });

  it('needsTotpStepUp is the inverse of isCertMode', () => {
    vi.stubEnv('VITE_AUTH_MODE', 'cert');
    expect(needsTotpStepUp()).toBe(false);
    vi.stubEnv('VITE_AUTH_MODE', 'otp');
    expect(needsTotpStepUp()).toBe(true);
    vi.stubEnv('VITE_AUTH_MODE', '');
    expect(needsTotpStepUp()).toBe(true);
  });
});
