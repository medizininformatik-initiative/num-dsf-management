/**
 * clientCert-proxy-trust.test.ts — extractClientCert must only trust the
 * X-Client-* headers when the request provably comes from the front proxy:
 * shared secret in X-Proxy-Auth (CLIENT_CERT_PROXY_SECRET) and, optionally,
 * a peer address inside CLIENT_CERT_TRUSTED_PROXIES. Also covers the startup
 * guard that refuses cert mode in production without the secret.
 *
 * Dependencies: lib/clientCert, lib/certProxyTrust (pure — no DB/Redis).
 */
import type { Request } from 'express';
import { extractClientCert } from '../lib/clientCert';
import {
  assertCertProxyConfig,
  certHeadersWithoutTrustedProxy,
  resetProxyTrustWarning,
  warnIfProxySecretMissing,
} from '../lib/certProxyTrust';

const SAMPLE_PEM = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJALRiMLAh2wLSMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnRl
c3RjYTAeFw0yNTAxMDEwMDAwMDBaFw0yNjAxMDEwMDAwMDBaMBExDzANBgNVBAMM
BnRlc3RjYTBcMA0GCSqGSIb3DQEBAQUAA0sAMEgCQQC7o96HtiMR+dqpMgLzOPSx
5IAoMpOZzFMqxA7E5JN9GK5FdJoG9brkCaJMnoYhbyXjxyoGS2YqvECRnpc1bN0z
AgMBAAEwDQYJKoZIhvcNAQELBQADQQBY7lY1eByq0TA6M2qHTHmao+mSjHR8hEIq
b7dUjzKHYESSYsXoPNMiPiX85ysSGrFcdPt4MfrDXJe9Zk/3RmeO
-----END CERTIFICATE-----`;

const SECRET = 'a'.repeat(32) + 'b'.repeat(32);

function reqWith(headers: Record<string, string>, remoteAddress?: string): Request {
  return { headers, socket: { remoteAddress } } as unknown as Request;
}

const base = {
  'x-client-verify': 'SUCCESS',
  'x-client-cert': encodeURIComponent(SAMPLE_PEM),
};

// Skip the validity check so the sample cert (expired) is usable.
beforeAll(() => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2025-06-01T00:00:00Z'));
});
afterAll(() => jest.restoreAllMocks());

describe('extractClientCert – proxy secret', () => {
  afterEach(() => {
    delete process.env.CLIENT_CERT_PROXY_SECRET;
    delete process.env.CLIENT_CERT_TRUSTED_PROXIES;
  });

  it('keeps current behaviour when no secret is configured', () => {
    expect(extractClientCert(reqWith(base))).not.toBeNull();
  });

  it('rejects headers without X-Proxy-Auth when a secret is configured', () => {
    process.env.CLIENT_CERT_PROXY_SECRET = SECRET;
    expect(extractClientCert(reqWith(base))).toBeNull();
  });

  it('rejects a wrong secret, including one of different length', () => {
    process.env.CLIENT_CERT_PROXY_SECRET = SECRET;
    expect(extractClientCert(reqWith({ ...base, 'x-proxy-auth': 'x'.repeat(64) }))).toBeNull();
    expect(extractClientCert(reqWith({ ...base, 'x-proxy-auth': 'short' }))).toBeNull();
  });

  it('accepts the matching secret', () => {
    process.env.CLIENT_CERT_PROXY_SECRET = SECRET;
    expect(extractClientCert(reqWith({ ...base, 'x-proxy-auth': SECRET }))).not.toBeNull();
  });
});

describe('extractClientCert – trusted proxy addresses', () => {
  afterEach(() => {
    delete process.env.CLIENT_CERT_PROXY_SECRET;
    delete process.env.CLIENT_CERT_TRUSTED_PROXIES;
  });

  it('rejects a peer outside the list', () => {
    process.env.CLIENT_CERT_TRUSTED_PROXIES = '172.28.71.1, 10.0.0.0/8';
    expect(extractClientCert(reqWith(base, '172.28.71.99'))).toBeNull();
  });

  it('accepts an exact IP and a CIDR member, normalising ::ffff: mapping', () => {
    process.env.CLIENT_CERT_TRUSTED_PROXIES = '172.28.71.1, 10.0.0.0/8';
    expect(extractClientCert(reqWith(base, '172.28.71.1'))).not.toBeNull();
    expect(extractClientCert(reqWith(base, '::ffff:10.4.5.6'))).not.toBeNull();
  });

  it('rejects when the peer address is unknown', () => {
    process.env.CLIENT_CERT_TRUSTED_PROXIES = '172.28.71.1';
    expect(extractClientCert(reqWith(base, undefined))).toBeNull();
  });

  it('requires both secret and address when both are set', () => {
    process.env.CLIENT_CERT_PROXY_SECRET = SECRET;
    process.env.CLIENT_CERT_TRUSTED_PROXIES = '172.28.71.1';
    const good = { ...base, 'x-proxy-auth': SECRET };
    expect(extractClientCert(reqWith(good, '172.28.71.1'))).not.toBeNull();
    expect(extractClientCert(reqWith(good, '172.28.71.2'))).toBeNull();
    expect(extractClientCert(reqWith(base, '172.28.71.1'))).toBeNull();
  });
});

describe('assertCertProxyConfig', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('throws in cert mode + production without a secret', () => {
    process.env.AUTH_MODE = 'cert';
    process.env.NODE_ENV = 'production';
    delete process.env.CLIENT_CERT_PROXY_SECRET;
    expect(() => assertCertProxyConfig()).toThrow(/CLIENT_CERT_PROXY_SECRET/);
  });

  it('throws when the secret is shorter than 32 characters', () => {
    process.env.AUTH_MODE = 'cert';
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_CERT_PROXY_SECRET = 'short';
    expect(() => assertCertProxyConfig()).toThrow(/32/);
  });

  it('does not throw with a long secret, outside production, or outside cert mode', () => {
    process.env.AUTH_MODE = 'cert';
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_CERT_PROXY_SECRET = SECRET;
    expect(() => assertCertProxyConfig()).not.toThrow();
    delete process.env.CLIENT_CERT_PROXY_SECRET;
    process.env.NODE_ENV = 'development';
    expect(() => assertCertProxyConfig()).not.toThrow();
    process.env.NODE_ENV = 'production';
    process.env.AUTH_MODE = 'otp';
    expect(() => assertCertProxyConfig()).not.toThrow();
  });

  it('never puts the secret in the error message', () => {
    process.env.AUTH_MODE = 'cert';
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_CERT_PROXY_SECRET = 'tooshort-secret';
    try {
      assertCertProxyConfig();
    } catch (e) {
      expect((e as Error).message).not.toContain('tooshort-secret');
    }
  });
});

describe('trusted proxy list – malformed entries fail closed', () => {
  afterEach(() => {
    delete process.env.CLIENT_CERT_TRUSTED_PROXIES;
  });

  it.each(['172.28.71.1/', '::/', '172.28.71.1/1e1', '172.28.71.1/33', '172.28.71.1/ 8', '/8'])(
    'entry %s trusts nobody',
    (entry) => {
      process.env.CLIENT_CERT_TRUSTED_PROXIES = entry;
      expect(extractClientCert(reqWith(base, '8.8.8.8'))).toBeNull();
      expect(extractClientCert(reqWith(base, '2001:db8::1'))).toBeNull();
      expect(extractClientCert(reqWith(base, '172.28.71.1'))).toBeNull();
    },
  );

  it('a valid entry after a malformed one still works and the list follows env changes', () => {
    process.env.CLIENT_CERT_TRUSTED_PROXIES = '1.2.3.4/, 10.0.0.0/8';
    expect(extractClientCert(reqWith(base, '10.1.1.1'))).not.toBeNull();
    expect(extractClientCert(reqWith(base, '1.2.3.4'))).toBeNull();
    process.env.CLIENT_CERT_TRUSTED_PROXIES = '192.168.0.0/16';
    expect(extractClientCert(reqWith(base, '10.1.1.1'))).toBeNull();
    expect(extractClientCert(reqWith(base, '192.168.5.5'))).not.toBeNull();
  });
});

describe('fail closed outside development/test without a secret', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it.each(['production', undefined])('NODE_ENV=%s: no secret means no client cert', (env) => {
    delete process.env.CLIENT_CERT_PROXY_SECRET;
    if (env) process.env.NODE_ENV = env;
    else delete process.env.NODE_ENV;
    expect(extractClientCert(reqWith(base))).toBeNull();
  });

  it('production with the matching secret works, and the secret is trimmed', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_CERT_PROXY_SECRET = `${SECRET}
`;
    expect(extractClientCert(reqWith({ ...base, 'x-proxy-auth': SECRET }))).not.toBeNull();
  });

  it('a blank secret is no secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_CERT_PROXY_SECRET = '   ';
    expect(extractClientCert(reqWith(base))).toBeNull();
  });

  it('warns once-worthy text without the secret outside cert mode, stays quiet otherwise', () => {
    const warn = jest.fn();
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_MODE;
    delete process.env.CLIENT_CERT_PROXY_SECRET;
    warnIfProxySecretMissing({ warn });
    expect(warn).toHaveBeenCalledTimes(1);
    process.env.CLIENT_CERT_PROXY_SECRET = SECRET;
    warnIfProxySecretMissing({ warn });
    process.env.NODE_ENV = 'test';
    delete process.env.CLIENT_CERT_PROXY_SECRET;
    warnIfProxySecretMissing({ warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(SECRET);
  });
});

describe('certHeadersWithoutTrustedProxy', () => {
  afterEach(() => {
    delete process.env.CLIENT_CERT_PROXY_SECRET;
    resetProxyTrustWarning();
  });

  it('is true when certificate headers come without a valid X-Proxy-Auth', () => {
    process.env.CLIENT_CERT_PROXY_SECRET = SECRET;
    const warn = jest.fn();
    expect(certHeadersWithoutTrustedProxy(reqWith(base), { warn })).toBe(true);
    expect(
      certHeadersWithoutTrustedProxy(reqWith({ ...base, 'x-proxy-auth': 'wrong' }), { warn }),
    ).toBe(true);
    expect(certHeadersWithoutTrustedProxy(reqWith({ 'x-client-verify': 'NONE' }), { warn })).toBe(
      true,
    );
  });

  it('is false without certificate headers or with a valid proxy', () => {
    process.env.CLIENT_CERT_PROXY_SECRET = SECRET;
    const warn = jest.fn();
    expect(certHeadersWithoutTrustedProxy(reqWith({}), { warn })).toBe(false);
    expect(
      certHeadersWithoutTrustedProxy(reqWith({ ...base, 'x-proxy-auth': SECRET }), { warn }),
    ).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns at most once a minute and never logs the secret or header values', () => {
    process.env.CLIENT_CERT_PROXY_SECRET = SECRET;
    const warn = jest.fn();
    const req = reqWith({ ...base, 'x-proxy-auth': 'wrong-value' });
    certHeadersWithoutTrustedProxy(req, { warn }, 1_000_000);
    certHeadersWithoutTrustedProxy(req, { warn }, 1_030_000);
    expect(warn).toHaveBeenCalledTimes(1);
    certHeadersWithoutTrustedProxy(req, { warn }, 1_061_000);
    expect(warn).toHaveBeenCalledTimes(2);
    const text = String(warn.mock.calls[0][0]);
    expect(text).toContain('X-Proxy-Auth');
    for (const secret of [SECRET, 'wrong-value', 'SUCCESS']) expect(text).not.toContain(secret);
  });
});
