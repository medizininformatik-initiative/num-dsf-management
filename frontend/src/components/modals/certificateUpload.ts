/**
 * certificateUpload.ts — client-side helpers shared by the certificate upload
 * and renewal forms: quick PEM checks (private key, certificate markers), the
 * file picker's accept list and reader, and the mapping of the backend's
 * upload error codes to translated messages. Private keys are recognised here
 * so they are never sent anywhere, not even to the preview endpoint.
 * Dependencies: lib/getErrorMessage, i18n keys.
 */
import { getErrorCode, getErrorMessage } from '../../lib/getErrorMessage';
import type { CertValidity } from '../../lib/certStatus';
import type { TranslationKey } from '../../i18n/en';

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Extensions and media types offered by the file picker. */
export const PEM_FILE_ACCEPT =
  '.pem,.crt,.cer,application/x-pem-file,application/x-x509-ca-cert,application/pkix-cert';

/** Far above any PEM certificate (chain); larger files are not read at all. */
const MAX_PEM_FILE_BYTES = 64 * 1024;

export function containsPrivateKey(text: string): boolean {
  return text.includes('PRIVATE KEY');
}

/** Both certificate markers present: worth asking the server for a preview. */
export function looksLikeCertificate(text: string): boolean {
  return text.includes('-----BEGIN CERTIFICATE-----') && text.includes('-----END CERTIFICATE-----');
}

export type PemFileResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'tooLarge' | 'unreadable' | 'privateKey' | 'notPem' };

/** Read a picked or dropped file as text and check that it holds a PEM certificate. */
export function readPemFile(file: File): Promise<PemFileResult> {
  if (file.size > MAX_PEM_FILE_BYTES) return Promise.resolve({ ok: false, reason: 'tooLarge' });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve({ ok: false, reason: 'unreadable' });
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      if (containsPrivateKey(text)) resolve({ ok: false, reason: 'privateKey' });
      else if (!looksLikeCertificate(text)) resolve({ ok: false, reason: 'notPem' });
      else resolve({ ok: true, text });
    };
    reader.readAsText(file);
  });
}

/** Message key per file problem. */
export const PEM_FILE_ERROR_KEY: Record<
  Exclude<PemFileResult, { ok: true }>['reason'],
  TranslationKey
> = {
  tooLarge: 'formPemFileTooLarge',
  unreadable: 'formPemFileUnreadable',
  privateKey: 'formPemFilePrivateKey',
  notPem: 'formPemFileNotPem',
};

const UPLOAD_ERROR_KEY: Record<string, TranslationKey> = {
  PRIVATE_KEY_REJECTED: 'certModalPrivateKeyDetected',
  INVALID_PEM: 'formCertErrorInvalidPem',
  CA_BLACKLISTED: 'formCertErrorBlacklisted',
  CA_NOT_WHITELISTED: 'formCertErrorNotWhitelisted',
};

/** Translated reason for a failed certificate upload or renewal. */
export function certificateUploadError(err: unknown, t: Translate, fallback: string): string {
  const key = UPLOAD_ERROR_KEY[getErrorCode(err) ?? ''];
  return key ? t(key) : getErrorMessage(err, fallback);
}

/** Short validity text for a status pill: "Expired", "Expires today", "12 days left". */
export function certValidityLabel({ state, days }: CertValidity, t: Translate): string {
  if (state === 'expired') return t('formCertExpired');
  if (days === 0) return t('formCertExpiresToday');
  if (days === 1) return t('formCertDayLeft');
  return t('formCertDaysLeft', { n: days });
}
