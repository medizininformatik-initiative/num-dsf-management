/**
 * request-risk.service.ts – Gathers everything lib/requestRisk needs for a batch of pending
 * approval requests and returns one assessment per request. The number of queries does not grow
 * with the number of requests: previous approved snapshots (the latest two per instance) in one
 * windowed query, certificates, request history, submit IPs, shared IPs and the owners in one
 * query each, the CA lists once.
 *
 * Known submit IPs (NEW_SUBMIT_IP): logins and submits of the instance or its owner up to the
 * moment the previous request was approved (plus a second of slack, as stored timestamps lose
 * their fraction); without a previous approval, up to 24 h before the submit. The submitter's
 * own login right before the submit therefore never makes its IP look familiar.
 *
 * Dependencies: db/connection, lib/requestRisk, lib/certDescribe, ca-whitelist.service,
 *               ca-blacklist.service
 */
import { db } from '../db/connection';
import { describeCertificate } from '../lib/certDescribe';
import {
  assessRequest,
  type CaStatus,
  type CertInfo,
  type RiskAssessment,
  type RiskContext,
} from '../lib/requestRisk';
import { blacklistedIssuers } from './ca-blacklist.service';
import { whitelistedIssuers } from './ca-whitelist.service';

const DAY_MS = 86400_000;
const WINDOW_MS = 30 * DAY_MS;
// approval_requests.submitted_at / resolved_at are stored without fractional seconds, audit
// timestamps may not be.
const TIMESTAMP_SLACK_MS = 1000;
// Without a previous approval, logins this close to the submit do not count as "known".
const SUBMIT_WINDOW_MS = DAY_MS;

export interface PendingRequestRow {
  id: string;
  instance_id: string;
  submitted_at?: Date | string | null;
  created_at?: Date | string | null;
  snapshot_json: unknown;
}

type Snapshot = Record<string, unknown>;

function parse(raw: unknown): Snapshot | null {
  try {
    const v: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Snapshot) : null;
  } catch {
    return null;
  }
}

function certEntries(snapshot: Snapshot | null): Array<Record<string, unknown>> {
  const certs = snapshot?.certificates;
  if (!Array.isArray(certs)) return [];
  return certs.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object');
}

function ipsOf(snapshot: Snapshot | null): string[] {
  const endpoints = snapshot?.endpoints;
  if (!Array.isArray(endpoints)) return [];
  const out: string[] = [];
  for (const e of endpoints) {
    const rec = (e as { ipAddresses?: unknown; ips?: unknown } | null) ?? {};
    const entries = Array.isArray(rec.ipAddresses)
      ? rec.ipAddresses
      : Array.isArray(rec.ips)
        ? rec.ips
        : [];
    for (const entry of entries) {
      const ip = (entry as { ip?: unknown } | null)?.ip;
      if (typeof ip === 'string') out.push(ip);
    }
  }
  return out;
}

async function loadCertInfo(ids: string[]): Promise<Record<string, CertInfo>> {
  const out: Record<string, CertInfo> = {};
  if (ids.length === 0) return out;
  const rows: Array<{ id: string; pem: string }> = await db('certificates')
    .whereIn('id', ids)
    .select('id', 'pem');
  for (const row of rows) {
    const info = describeCertificate(row.pem);
    if (info) out[row.id] = info;
  }
  return out;
}

async function loadCaStatus(issuerDns: string[]): Promise<Record<string, CaStatus>> {
  const unique = [...new Set(issuerDns)];
  const out: Record<string, CaStatus> = {};
  if (unique.length === 0) return out;
  const [whitelisted, blacklisted] = await Promise.all([
    whitelistedIssuers(unique),
    blacklistedIssuers(unique),
  ]);
  for (const dn of unique) {
    out[dn] = blacklisted.has(dn) ? 'blacklisted' : whitelisted.has(dn) ? 'whitelisted' : 'unknown';
  }
  return out;
}

interface Approved {
  snapshot: Snapshot | null;
  resolvedAt: Date;
}

/** The latest two APPROVED snapshots per instance (newest first), in one query. */
async function loadApproved(instanceIds: string[]): Promise<Map<string, Approved[]>> {
  const ranked = db('approval_requests')
    .select('instance_id', 'snapshot_json')
    .select(db.raw('COALESCE(resolved_at, created_at) AS at'))
    .select(
      db.raw(
        'ROW_NUMBER() OVER (PARTITION BY instance_id ORDER BY COALESCE(resolved_at, created_at) DESC, id DESC) AS rn',
      ),
    )
    .where({ status: 'APPROVED' })
    .whereIn('instance_id', instanceIds)
    .as('t');
  const rows: Array<{
    instance_id: string;
    snapshot_json: unknown;
    at: Date;
    rn: number | string;
  }> = await db.select('*').from(ranked).where('rn', '<=', 2).orderBy('rn', 'asc');
  const map = new Map<string, Approved[]>();
  for (const r of rows) {
    const list = map.get(r.instance_id) ?? [];
    list.push({ snapshot: parse(r.snapshot_json), resolvedAt: new Date(r.at) });
    map.set(r.instance_id, list);
  }
  return map;
}

/** Status counts (REJECTED / WITHDRAWN) of the last 30 days, per instance. */
async function loadHistoryCounts(
  instanceIds: string[],
  now: Date,
): Promise<Map<string, { rejected: number; withdrawn: number }>> {
  const rows: Array<{ instance_id: string; status: string; n: number | string }> = await db(
    'approval_requests',
  )
    .whereIn('instance_id', instanceIds)
    .whereIn('status', ['REJECTED', 'WITHDRAWN'])
    .where('resolved_at', '>=', new Date(now.getTime() - WINDOW_MS))
    .groupBy('instance_id', 'status')
    .select('instance_id', 'status')
    .count({ n: '*' });
  const map = new Map<string, { rejected: number; withdrawn: number }>();
  for (const r of rows) {
    const entry = map.get(r.instance_id) ?? { rejected: 0, withdrawn: 0 };
    if (r.status === 'REJECTED') entry.rejected = Number(r.n);
    else entry.withdrawn = Number(r.n);
    map.set(r.instance_id, entry);
  }
  return map;
}

/** IP of each request's own submit (the CREATE audit entry written by submitApproval). */
async function loadSubmitterIps(requestIds: string[]): Promise<Map<string, string>> {
  const rows: Array<{ resource_id: string; ip_address: string | null }> = await db('audit_logs')
    .where({ resource_type: 'APPROVAL', operation: 'CREATE' })
    .whereIn('resource_id', requestIds)
    .select('resource_id', 'ip_address');
  const map = new Map<string, string>();
  for (const r of rows) if (r.ip_address) map.set(r.resource_id, r.ip_address);
  return map;
}

interface SeenIp {
  ip: string;
  instanceId: string | null;
  email: string | null;
  firstSeen: Date;
}

/**
 * Distinct (IP, instance, user) triples of logins and submits of these instances or their
 * owners (both columns are indexed), excluding the pending requests' own submits.
 */
async function loadSeenIps(
  requestIds: string[],
  instanceIds: string[],
  ownerEmails: string[],
): Promise<SeenIp[]> {
  const rows: Array<{
    ip_address: string;
    instance_id: string | null;
    user_email: string | null;
    first_seen: Date;
  }> = await db('audit_logs')
    .whereNotNull('ip_address')
    .where((q) => q.whereIn('instance_id', instanceIds).orWhereIn('user_email', ownerEmails))
    .where((q) =>
      q
        .where('operation', 'LOGIN')
        .orWhere((r) => r.where({ operation: 'CREATE', resource_type: 'APPROVAL' })),
    )
    .where((q) => q.whereNull('resource_id').orWhereNotIn('resource_id', requestIds))
    .groupBy('ip_address', 'instance_id', 'user_email')
    .select('ip_address', 'instance_id', 'user_email')
    .min({ first_seen: 'timestamp' });
  return rows.map((r) => ({
    ip: r.ip_address,
    instanceId: r.instance_id,
    email: r.user_email,
    firstSeen: new Date(r.first_seen),
  }));
}

/** IP → organizations that have the same address on an endpoint. */
async function loadOrgsByIp(ips: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ips.length === 0) return map;
  const rows: Array<{ ip: string; organization_id: string }> = await db('endpoint_ips as i')
    .join('endpoints as e', 'e.identifier', 'i.endpoint_id')
    .whereIn('i.ip', ips)
    .select('i.ip as ip', 'e.organization_id as organization_id');
  for (const r of rows) {
    const list = map.get(r.ip) ?? [];
    if (!list.includes(r.organization_id)) list.push(r.organization_id);
    map.set(r.ip, list);
  }
  return map;
}

/** Instances whose organization has a login entry that does not come from an approval. */
async function loadOrgsWithOtherLogin(instanceIds: string[]): Promise<Set<string>> {
  const rows: Array<{ instance_id: string }> = await db('org_login_certificates as l')
    .join('organizations as o', 'o.identifier', 'l.organization_id')
    .whereIn('o.instance_id', instanceIds)
    .whereNot('l.source', 'APPROVAL')
    .distinct('o.instance_id');
  return new Set(rows.map((r) => r.instance_id));
}

/** Risk assessment per pending request id. */
export async function assessPendingRequests(
  requests: PendingRequestRow[],
  now: Date = new Date(),
): Promise<Map<string, RiskAssessment>> {
  const result = new Map<string, RiskAssessment>();
  if (requests.length === 0) return result;
  const instanceIds = [...new Set(requests.map((r) => r.instance_id))];
  const requestIds = requests.map((r) => r.id);

  const [approved, history, submitterIps, owners] = await Promise.all([
    loadApproved(instanceIds),
    loadHistoryCounts(instanceIds, now),
    loadSubmitterIps(requestIds),
    db('instances as i')
      .join('users as u', 'u.id', 'i.user_id')
      .whereIn('i.id', instanceIds)
      .select('i.id as id', 'u.email as email') as Promise<Array<{ id: string; email: string }>>,
  ]);
  const ownerEmail = new Map(owners.map((o) => [o.id, o.email]));
  const currentById = new Map(requests.map((r) => [r.id, parse(r.snapshot_json)]));

  const snapshots = [
    ...currentById.values(),
    ...[...approved.values()].flatMap((l) => l.map((a) => a.snapshot)),
  ];
  const certIds = new Set<string>();
  const issuerDns = new Set<string>();
  for (const snap of snapshots) {
    for (const c of certEntries(snap)) {
      if (typeof c.id === 'string') certIds.add(c.id);
      if (typeof c.issuerDn === 'string') issuerDns.add(c.issuerDn);
    }
  }
  const allIps = new Set<string>();
  for (const snap of currentById.values()) ipsOf(snap).forEach((ip) => allIps.add(ip));

  const [certInfo, seen, orgsByIp, outsideLogins] = await Promise.all([
    loadCertInfo([...certIds]),
    loadSeenIps(requestIds, instanceIds, [...new Set(owners.map((o) => o.email))]),
    loadOrgsByIp([...allIps]),
    loadOrgsWithOtherLogin(instanceIds),
  ]);
  Object.values(certInfo).forEach((c) => issuerDns.add(c.issuerDn));
  const caStatus = await loadCaStatus([...issuerDns]);

  for (const req of requests) {
    const submitted = new Date(req.submitted_at ?? req.created_at ?? now);
    const current = currentById.get(req.id) ?? null;
    const [previous, beforePrevious] = approved.get(req.instance_id) ?? [];
    const cutoff = previous
      ? previous.resolvedAt.getTime() + TIMESTAMP_SLACK_MS
      : submitted.getTime() - SUBMIT_WINDOW_MS;
    const known = new Set(
      seen
        .filter(
          (s) =>
            s.firstSeen.getTime() <= cutoff &&
            (s.instanceId === req.instance_id ||
              (!!s.email && s.email === ownerEmail.get(req.instance_id))),
        )
        .map((s) => s.ip),
    );
    const org = current?.organization;
    const ownOrg =
      org && typeof org === 'object'
        ? String((org as { identifier?: unknown }).identifier ?? '')
        : '';
    const otherOrgsByIp: Record<string, string[]> = {};
    for (const ip of ipsOf(current)) {
      const others = (orgsByIp.get(ip) ?? []).filter((o) => o !== ownOrg);
      if (others.length > 0) otherOrgsByIp[ip] = others;
    }
    const counts = history.get(req.instance_id) ?? { rejected: 0, withdrawn: 0 };
    const context: RiskContext = {
      rejectedLast30d: counts.rejected,
      withdrawnLast30d: counts.withdrawn,
      submitterIp: submitterIps.get(req.id) ?? null,
      knownSubmitIps: [...known],
      otherOrgsByIp,
      hasLoginOutsideApproval: outsideLogins.has(req.instance_id),
      now,
    };
    result.set(
      req.id,
      assessRequest({
        current: current ?? {},
        previous: previous?.snapshot ?? null,
        previousResolvedAt: previous?.resolvedAt ?? null,
        beforePrevious: beforePrevious?.snapshot ?? null,
        certInfo,
        caStatus,
        context,
      }),
    );
  }
  return result;
}
