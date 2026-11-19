/**
 * request-risk.service.ts – Gathers everything lib/requestRisk needs for a batch of pending
 * approval requests (previous approved snapshot, parsed certificates, CA list status, request
 * history, submit IPs, shared IPs) in a fixed number of queries per batch (plus one lookup
 * of the previous snapshot per instance) and returns one assessment per request.
 * Dependencies: db/connection, lib/requestRisk, ca-whitelist.service, ca-blacklist.service,
 *               node:crypto
 */
import crypto from 'crypto';
import { db } from '../db/connection';
import {
  assessRequest,
  type CaStatus,
  type CertInfo,
  type RiskAssessment,
  type RiskContext,
} from '../lib/requestRisk';
import { whitelistedIssuers } from './ca-whitelist.service';
import { isCaBlacklisted } from './ca-blacklist.service';

const WINDOW_MS = 30 * 86400_000;
// approval_requests.submitted_at is stored without fractional seconds, audit timestamps may not be.
const TIMESTAMP_SLACK_MS = 1000;

export interface PendingRequestRow {
  id: string;
  instance_id: string;
  submitted_at?: Date | string | null;
  created_at?: Date | string | null;
  snapshot_json: unknown;
}

function parse(raw: unknown): Record<string, unknown> | null {
  try {
    const v: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function certIds(snapshot: Record<string, unknown> | null): string[] {
  const certs = snapshot?.certificates;
  if (!Array.isArray(certs)) return [];
  return certs
    .map((c) => (c && typeof c === 'object' ? (c as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string');
}

function ipsOf(snapshot: Record<string, unknown> | null): string[] {
  const endpoints = snapshot?.endpoints;
  if (!Array.isArray(endpoints)) return [];
  const out: string[] = [];
  for (const e of endpoints) {
    const list = (e as { ipAddresses?: unknown; ips?: unknown } | null) ?? {};
    const entries = Array.isArray(list.ipAddresses)
      ? list.ipAddresses
      : Array.isArray(list.ips)
        ? list.ips
        : [];
    for (const entry of entries) {
      const ip = (entry as { ip?: unknown } | null)?.ip;
      if (typeof ip === 'string') out.push(ip);
    }
  }
  return out;
}

/** Issuer, subject, DNS names and expiry of a stored PEM; null when it cannot be parsed. */
function describeCertificate(pem: string): CertInfo | null {
  try {
    const cert = new crypto.X509Certificate(pem);
    const sanDns = (cert.subjectAltName ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.startsWith('DNS:'))
      .map((part) => part.slice(4));
    return {
      issuerDn: cert.issuer.split('\n').join(','),
      subjectDn: cert.subject.split('\n').join(','),
      sanDns,
      notAfter: new Date(cert.validTo).toISOString(),
    };
  } catch {
    return null;
  }
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
  const out: Record<string, CaStatus> = {};
  const unique = [...new Set(issuerDns)];
  if (unique.length === 0) return out;
  const whitelisted = await whitelistedIssuers(unique);
  for (const dn of unique) {
    if (await isCaBlacklisted({ subjectDn: dn })) out[dn] = 'blacklisted';
    else out[dn] = whitelisted.has(dn) ? 'whitelisted' : 'unknown';
  }
  return out;
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

/** Distinct (IP, instance, user) triples of earlier logins and submits, excluding these requests. */
async function loadSeenIps(requestIds: string[]): Promise<SeenIp[]> {
  const rows: Array<{
    ip_address: string;
    instance_id: string | null;
    user_email: string | null;
    first_seen: Date;
  }> = await db('audit_logs')
    .whereNotNull('ip_address')
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

/** IP → other organizations (not the site's own) that have the same address on an endpoint. */
async function loadOtherOrgsByIp(ips: string[]): Promise<Map<string, string[]>> {
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

/**
 * Risk assessment per pending request id. Never throws for one unreadable snapshot: that
 * request is assessed as a first request with whatever could be read.
 */
export async function assessPendingRequests(
  requests: PendingRequestRow[],
  now: Date = new Date(),
): Promise<Map<string, RiskAssessment>> {
  const result = new Map<string, RiskAssessment>();
  if (requests.length === 0) return result;
  const instanceIds = [...new Set(requests.map((r) => r.instance_id))];
  const requestIds = requests.map((r) => r.id);

  const previousRows = await Promise.all(
    instanceIds.map(async (id) => ({
      id,
      row: await db('approval_requests')
        .where({ instance_id: id, status: 'APPROVED' })
        .orderByRaw('COALESCE(resolved_at, created_at) DESC')
        .first('snapshot_json'),
    })),
  );
  const previousByInstance = new Map(
    previousRows.map(({ id, row }) => [id, row ? parse(row.snapshot_json) : null]),
  );
  const currentById = new Map(requests.map((r) => [r.id, parse(r.snapshot_json)]));

  const allCertIds = new Set<string>();
  const allIps = new Set<string>();
  for (const snap of [...currentById.values(), ...previousByInstance.values()]) {
    certIds(snap).forEach((id) => allCertIds.add(id));
  }
  for (const snap of currentById.values()) ipsOf(snap).forEach((ip) => allIps.add(ip));

  const certInfo = await loadCertInfo([...allCertIds]);
  const caStatus = await loadCaStatus(Object.values(certInfo).map((c) => c.issuerDn));
  const [history, submitterIps, seen, otherOrgs, owners] = await Promise.all([
    loadHistoryCounts(instanceIds, now),
    loadSubmitterIps(requestIds),
    loadSeenIps(requestIds),
    loadOtherOrgsByIp([...allIps]),
    db('instances as i')
      .join('users as u', 'u.id', 'i.user_id')
      .whereIn('i.id', instanceIds)
      .select('i.id as id', 'u.email as email') as Promise<Array<{ id: string; email: string }>>,
  ]);
  const ownerEmail = new Map(owners.map((o) => [o.id, o.email]));

  for (const req of requests) {
    const submitted = new Date(req.submitted_at ?? req.created_at ?? now);
    const current = currentById.get(req.id) ?? null;
    const known = new Set(
      seen
        .filter(
          (s) =>
            s.firstSeen.getTime() <= submitted.getTime() + TIMESTAMP_SLACK_MS &&
            (s.instanceId === req.instance_id ||
              (!!s.email && s.email === ownerEmail.get(req.instance_id))),
        )
        .map((s) => s.ip),
    );
    const ownOrg =
      current && typeof current.organization === 'object' && current.organization
        ? String((current.organization as { identifier?: unknown }).identifier ?? '')
        : '';
    const otherOrgsByIp: Record<string, string[]> = {};
    for (const ip of ipsOf(current)) {
      const others = (otherOrgs.get(ip) ?? []).filter((o) => o !== ownOrg);
      if (others.length > 0) otherOrgsByIp[ip] = others;
    }
    const counts = history.get(req.instance_id) ?? { rejected: 0, withdrawn: 0 };
    const context: RiskContext = {
      rejectedLast30d: counts.rejected,
      withdrawnLast30d: counts.withdrawn,
      submitterIp: submitterIps.get(req.id) ?? null,
      knownSubmitIps: [...known],
      otherOrgsByIp,
      now,
    };
    result.set(
      req.id,
      assessRequest({
        current: current ?? {},
        previous: previousByInstance.get(req.instance_id) ?? null,
        certInfo,
        caStatus,
        context,
      }),
    );
  }
  return result;
}
