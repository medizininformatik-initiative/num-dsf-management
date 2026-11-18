/**
 * snapshotCompare.ts – Pure comparison of two approval snapshots (current data vs. the last approved one).
 * Ignores volatile timestamps and array order, so only real data changes count.
 * Dependencies: none
 */

const VOLATILE_KEYS = new Set([
  'snapshotAt',
  'created_at',
  'updated_at',
  'submitted_at',
  'resolved_at',
]);

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

/** Parse a snapshot given as JSON string or object; undefined when unreadable. */
function normalize(raw: unknown): unknown | undefined {
  try {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (text === undefined) return undefined;
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? canonicalize(parsed) : undefined;
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
  return JSON.stringify(a) !== JSON.stringify(b);
}
