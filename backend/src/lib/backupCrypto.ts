/**
 * backupCrypto.ts – optional AES-256-GCM encryption of backup files.
 *
 * File layout: "DSFBAK01" (8 bytes, also the AAD) | IV (12) | ciphertext | auth tag (16).
 * The key is BACKUP_ENCRYPTION_KEY: 64 hex characters (32 bytes). Without the
 * key an encrypted backup cannot be restored, so keep it apart from the files.
 * Dependencies: crypto, stream
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Transform, TransformCallback } from 'stream';

const MAGIC = Buffer.from('DSFBAK01', 'ascii');
const IV_LEN = 12;
const TAG_LEN = 16;

/** Reads BACKUP_ENCRYPTION_KEY; null when unset, throws when malformed. */
export function readBackupKey(
  raw: string | undefined = process.env.BACKUP_ENCRYPTION_KEY,
): Buffer | null {
  if (!raw) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(raw, 'hex');
}

export function isEncryptedBackup(buf: Buffer): boolean {
  return buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

/** Stream transform: emits header + ciphertext, appends the auth tag on flush. */
export function createEncryptStream(key: Buffer): Transform {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  let headerSent = false;
  const header = (): Buffer => {
    if (headerSent) return Buffer.alloc(0);
    headerSent = true;
    return Buffer.concat([MAGIC, iv]);
  };
  return new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
      cb(null, Buffer.concat([header(), cipher.update(chunk)]));
    },
    flush(cb: TransformCallback) {
      cb(null, Buffer.concat([header(), cipher.final(), cipher.getAuthTag()]));
    },
  });
}

/** Decrypts a whole encrypted backup file held in memory. */
export function decryptBackup(buf: Buffer, key: Buffer): Buffer {
  if (!isEncryptedBackup(buf) || buf.length < MAGIC.length + IV_LEN + TAG_LEN) {
    throw new Error('Not an encrypted backup file');
  }
  const iv = buf.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const body = buf.subarray(MAGIC.length + IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error('Decryption failed: wrong BACKUP_ENCRYPTION_KEY or the file was modified');
  }
}
