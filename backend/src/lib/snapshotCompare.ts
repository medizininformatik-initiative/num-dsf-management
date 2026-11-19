/**
 * snapshotCompare.ts – Pure comparison of two approval snapshots (current data vs. the last approved one).
 * Ignores volatile timestamps, system/admin-managed fields and array order, so only real data
 * changes count.
 * Dependencies: none
 */

const VOLATILE_KEYS = new Set([
  'snapshotAt',
  'created_at',
  'updated_at',
  'submitted_at',
  'resolved_at',
  // Set by the system or an admin, not part of what the site submits for approval.
  'email_validated',
  'client_cert_thumbprint',
  'client_cert_fingerprint',
  // Facts derived from a certificate's PEM; the thumbprint already identifies the certificate and
  // snapshots approved before these were stored must not read as changed.
  'issuerDn',
  'subjectDn',
  'sanDns',
  'notAfter',
  // Derived from the certificates and their use_for_login flag, which are compared themselves;
  // snapshots approved before migration 040 do not have it.
  'loginThumbprints',
]);

/** Keys a snapshot only carries since a later version; compared only when both sides have them. */
const OPTIONAL_KEYS = ['editableDigest'];

/** Canonical form: volatile keys dropped, object keys sorted, arrays ordered by their JSON string. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .map((v) => ({ v, key: JSON.stringify(v) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((e) => e.v);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Snapshots from before migration 040 carry no purpose flags on their certificates; both count as
 * set (the behaviour then), so they do not read as changed.
 */
function withCertificateDefaults(snapshot: unknown): unknown {
  const certs = (snapshot as { certificates?: unknown } | null)?.certificates;
  if (!Array.isArray(certs)) return snapshot;
  return {
    ...(snapshot as Record<string, unknown>),
    certificates: certs.map((c) =>
      c && typeof c === 'object'
        ? { publish_in_allowlist: true, use_for_login: true, ...(c as Record<string, unknown>) }
        : c,
    ),
  };
}

/** Parse a snapshot given as JSON string or object; undefined when unreadable. */
function normalize(raw: unknown): unknown | undefined {
  try {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (text === undefined) return undefined;
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object'
      ? canonicalize(withCertificateDefaults(parsed))
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the current snapshot differs from the approved one. Each side may be a JSON string
 * (the snapshot_json column) or an object. Null when either side is unreadable.
 */
export function snapshotsDiffer(current: unknown, approved: unknown): boolean | null {
  const a = normalize(current);
  const b = normalize(approved);
  if (a === undefined || b === undefined) return null;
  for (const key of OPTIONAL_KEYS) {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    if (!(key in ra) || !(key in rb)) {
      delete ra[key];
      delete rb[key];
    }
  }
  return JSON.stringify(a) !== JSON.stringify(b);
}
