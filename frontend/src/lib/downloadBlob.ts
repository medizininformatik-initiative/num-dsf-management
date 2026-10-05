/**
 * downloadBlob.ts – helpers of the download dialog: save a blob as a file, wrap
 * response data in a blob, read a response header and compute the SHA-256 of
 * received bytes. No dependencies.
 */

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function toBlob(data: BlobPart, type: string): Blob {
  return data instanceof Blob ? data : new Blob([data], { type });
}

/** A response header from axios (AxiosHeaders or a plain object). */
export function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const h = headers as { get?: (n: string) => unknown } & Record<string, unknown>;
  const value = typeof h.get === 'function' ? h.get(name) : h[name];
  return typeof value === 'string' && value ? value : null;
}

/** Hex SHA-256 of a blob, or null without WebCrypto (e.g. outside a secure context). */
export async function sha256Hex(blob: Blob): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof blob.arrayBuffer !== 'function') return null;
    const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
