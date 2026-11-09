/**
 * certificateUpload.test.ts — the client-side helpers of the certificate
 * forms: PEM checks, the file reader's verdicts (ok, private key, not PEM,
 * too large), the upload error-code mapping and the validity pill label.
 */
import { describe, it, expect } from 'vitest';
import {
  certificateUploadError,
  certValidityLabel,
  containsPrivateKey,
  looksLikeCertificate,
  readPemFile,
} from '../certificateUpload';
import { en, type TranslationKey } from '../../../i18n/en';

const PEM = '-----BEGIN CERTIFICATE-----\nQkFTRTY0Qk9EWQ==\n-----END CERTIFICATE-----';

function t(key: TranslationKey, params?: Record<string, string | number>) {
  let text: string = en[key];
  for (const [k, v] of Object.entries(params ?? {})) text = text.split(`{${k}}`).join(String(v));
  return text;
}

function apiError(code: string, message = code) {
  return { response: { data: { error: { code, message } } } };
}

describe('PEM checks', () => {
  it('needs both certificate markers', () => {
    expect(looksLikeCertificate(PEM)).toBe(true);
    expect(looksLikeCertificate('-----BEGIN CERTIFICATE-----\nQkFT')).toBe(false);
    expect(looksLikeCertificate('-----BEGIN CERTIFICATE REQUEST-----')).toBe(false);
  });

  it('spots private-key material', () => {
    expect(containsPrivateKey(`${PEM}\nPRIVATE KEY`)).toBe(true);
    expect(containsPrivateKey(PEM)).toBe(false);
  });
});

describe('readPemFile', () => {
  it('returns the text of a PEM certificate file', async () => {
    expect(await readPemFile(new File([PEM], 'a.pem'))).toEqual({ ok: true, text: PEM });
  });

  it('refuses files with a private key, binary files and oversized files', async () => {
    expect(await readPemFile(new File([`${PEM}\nPRIVATE KEY`], 'a.pem'))).toEqual({
      ok: false,
      reason: 'privateKey',
    });
    expect(await readPemFile(new File([new Uint8Array([0x30, 0x82])], 'a.cer'))).toEqual({
      ok: false,
      reason: 'notPem',
    });
    expect(await readPemFile(new File(['x'.repeat(70 * 1024)], 'big.pem'))).toEqual({
      ok: false,
      reason: 'tooLarge',
    });
  });
});

describe('certificateUploadError', () => {
  it('translates the known upload error codes', () => {
    expect(certificateUploadError(apiError('PRIVATE_KEY_REJECTED'), t, 'fallback')).toBe(
      en.certModalPrivateKeyDetected,
    );
    expect(certificateUploadError(apiError('INVALID_PEM'), t, 'fallback')).toBe(
      en.formCertErrorInvalidPem,
    );
    expect(certificateUploadError(apiError('CA_BLACKLISTED'), t, 'fallback')).toBe(
      en.formCertErrorBlacklisted,
    );
    expect(certificateUploadError(apiError('CA_NOT_WHITELISTED'), t, 'fallback')).toBe(
      en.formCertErrorNotWhitelisted,
    );
    expect(certificateUploadError(apiError('CERT_REGISTERED_ELSEWHERE'), t, 'fallback')).toBe(
      en.formCertErrorRegisteredElsewhere,
    );
  });

  it('falls back to the backend message or the default', () => {
    expect(certificateUploadError(apiError('CONFLICT', 'Already there'), t, 'fallback')).toBe(
      'Already there',
    );
    expect(certificateUploadError(new Error('offline'), t, 'fallback')).toBe('fallback');
  });
});

describe('certValidityLabel', () => {
  it('names expiry and the days left', () => {
    expect(certValidityLabel({ state: 'expired', days: -3 }, t)).toBe('Expired');
    expect(certValidityLabel({ state: 'critical', days: 0 }, t)).toBe('Expires today');
    expect(certValidityLabel({ state: 'critical', days: 1 }, t)).toBe('1 day left');
    expect(certValidityLabel({ state: 'valid', days: 200 }, t)).toBe('200 days left');
  });
});
