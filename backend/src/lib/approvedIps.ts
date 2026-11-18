/**
 * approvedIps.ts – Pure helper that reads the endpoint IPs out of an approval snapshot.
 * Dependencies: none
 */

/**
 * The sorted, de-duplicated endpoint IPs of an approved snapshot (the `snapshot_json` column,
 * a JSON string or an already parsed object; `ipAddresses` or the legacy `ips` key per endpoint).
 * Null when the snapshot is missing or unreadable, so callers can tell "unknown" from "no IPs".
 */
export function extractApprovedIps(raw: unknown): string[] | null {
  let snapshot: unknown = raw;
  if (typeof raw === 'string') {
    try {
      snapshot = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const endpoints = (snapshot as { endpoints?: unknown }).endpoints;
  if (!Array.isArray(endpoints)) return null;
  const ips = new Set<string>();
  for (const ep of endpoints) {
    const list =
      (ep as { ipAddresses?: unknown } | null)?.ipAddresses ??
      (ep as { ips?: unknown } | null)?.ips;
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const ip = (entry as { ip?: unknown } | null)?.ip;
      if (typeof ip === 'string') ips.add(ip);
    }
  }
  return [...ips].sort();
}
