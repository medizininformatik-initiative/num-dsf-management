/**
 * fingerprint.ts – Display helpers for certificate fingerprints. The DSF
 * thumbprint is the SHA-512 of the certificate DER as 128 lower-case hex
 * characters without separators; that raw form is what users copy into DSF
 * configuration, the grouping only makes it readable and comparable.
 */

/** Lower-case hex without separators, from raw hex or OpenSSL "AB:CD:..." output. */
export function normalizeFingerprint(input: string): string {
  return input.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

/** Split a fingerprint into fixed-size groups for display (default 4 characters). */
export function fingerprintGroups(hex: string, size = 4): string[] {
  const clean = normalizeFingerprint(hex);
  const groups: string[] = [];
  for (let i = 0; i < clean.length; i += size) groups.push(clean.slice(i, i + size));
  return groups;
}
