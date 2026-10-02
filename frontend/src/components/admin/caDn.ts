/**
 * caDn.ts – Display helpers for CA subject DNs on the admin CA lists. DNs
 * arrive in either order ("C=DE,O=…,CN=…" from certificates, "CN=…,O=…"
 * typed by admins) and may contain unescaped commas inside a value, so RDNs
 * are split only at a comma that starts a new "type=" pair.
 * Pure functions, no React. Dependencies: none.
 */

/** Split a DN into its "type=value" RDNs, tolerating commas inside values. */
export function splitDn(dn: string): string[] {
  return dn
    .split(/,(?=\s*[A-Za-z][A-Za-z0-9.-]*\s*=)/)
    .map((rdn) => rdn.trim())
    .filter(Boolean);
}

/**
 * The common name (CN) of a DN, unescaped, for use as a readable title.
 * Falls back to the whole DN when it carries no CN.
 */
export function commonName(dn: string): string {
  for (const rdn of splitDn(dn)) {
    const match = /^CN\s*=\s*(.+)$/i.exec(rdn);
    if (match) return match[1].replace(/\\(.)/g, '$1').trim();
  }
  return dn.trim();
}
