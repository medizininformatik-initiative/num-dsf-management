import { describe, it, expect, vi, afterEach } from 'vitest';
import { isCertMode, reauthRedirect, needsTotpStepUp } from '../authMode';
import { useAuthStore } from '../../stores/auth.store';

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

  describe('needsTotpStepUp', () => {
    const tokenWith = (claims: object): string =>
      `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.s`;
    const signIn = (claims: object): void =>
      useAuthStore.getState().setTokens(tokenWith(claims), { id: 'u', email: 'a@b.de' });

    afterEach(() => useAuthStore.getState().clearAuth());

    it('is always true outside the certificate deployment', () => {
      vi.stubEnv('VITE_AUTH_MODE', 'otp');
      expect(needsTotpStepUp()).toBe(true);
      vi.stubEnv('VITE_AUTH_MODE', '');
      expect(needsTotpStepUp()).toBe(true);
    });

    it('is true for an admin certificate session (unscoped token)', () => {
      vi.stubEnv('VITE_AUTH_MODE', 'cert');
      signIn({ sub: 'u', email: 'a@b.de', amr: 'cert' });
      expect(needsTotpStepUp()).toBe(true);
    });

    it('is false for an organization-scoped site session', () => {
      vi.stubEnv('VITE_AUTH_MODE', 'cert');
      signIn({ sub: 'u', email: 'a@b.de', amr: 'cert', kind: 'org', inst: 'i1' });
      expect(needsTotpStepUp()).toBe(false);
    });

    it('is false without a token in the certificate deployment', () => {
      vi.stubEnv('VITE_AUTH_MODE', 'cert');
      expect(needsTotpStepUp()).toBe(false);
    });
  });
});
