/**
 * requestRiskEndpoints.ts – Endpoint and IP part of the request-risk assessment. Endpoints are
 * compared by their normalised address: a host change, a scheme downgrade, a port or path change
 * and an unreadable address each get their own finding; new hosts on a foreign domain, private
 * or shared IPs and added or replaced IPs are judged on normalised IPs.
 * Dependencies: lib/requestRiskSupport, lib/requestRiskNet, lib/requestRiskCerts (RawFinding)
 */
import { isPrivateIp, normalizeIp, registrableDomain } from './requestRiskNet';
import type { RawFinding } from './requestRiskCerts';
import type { NSnap } from './requestRiskSupport';

const MAX_LISTED = 3;

function listed(items: string[]): string {
  return items.slice(0, MAX_LISTED).join(', ') + (items.length > MAX_LISTED ? ', …' : '');
}

export function analyzeEndpoints(args: {
  cur: NSnap;
  prev: NSnap | null;
  otherOrgsByIp: Record<string, string[]>;
}): RawFinding[] {
  const { cur, prev, otherOrgsByIp } = args;
  const out: RawFinding[] = [];
  const add = (code: string, params: Record<string, string | number> = {}) =>
    out.push({ code, params });

  const prevByIdent = new Map((prev?.endpoints ?? []).map((e) => [e.identifier, e]));
  const curByIdent = new Map(cur.endpoints.map((e) => [e.identifier, e]));
  const knownDomains = new Set<string>([registrableDomain(cur.orgId)]);
  for (const e of prev?.endpoints ?? []) {
    if (e.parsed.readable) knownDomains.add(registrableDomain(e.parsed.host));
  }
  const foreign = new Set<string>();
  const checkForeign = (host: string) => {
    const d = registrableDomain(host);
    if (!knownDomains.has(d) && !foreign.has(d)) {
      foreign.add(d);
      add('ENDPOINT_FOREIGN_DOMAIN', { host });
    }
  };

  for (const e of cur.endpoints) {
    const old = prevByIdent.get(e.identifier);
    if (prev && !old) add('ENDPOINT_ADDED', { identifier: e.identifier });
    if (!e.parsed.readable) {
      if (!old || old.address !== e.address) {
        add('ENDPOINT_ADDRESS_UNREADABLE', { identifier: e.identifier });
      }
      continue;
    }
    if (!old) {
      checkForeign(e.parsed.host);
      continue;
    }
    if (!old.parsed.readable) continue;
    const [o, n] = [old.parsed, e.parsed];
    if (o.host !== n.host) {
      add('ENDPOINT_ADDRESS_CHANGED', { from: o.host, to: n.host });
      checkForeign(n.host);
    } else if (o.path !== n.path || (o.scheme === n.scheme && o.port !== n.port)) {
      add('ENDPOINT_URL_CHANGED', { from: old.address, to: e.address });
    }
    if (o.scheme === 'https' && n.scheme === 'http') {
      add('ENDPOINT_SCHEME_DOWNGRADE', { host: n.host });
    }
  }
  if (prev) {
    for (const e of prev.endpoints) {
      if (!curByIdent.has(e.identifier)) add('ENDPOINT_REMOVED', { identifier: e.identifier });
    }
  }

  // IP addresses. Added / replaced are judged over endpoints present in both snapshots;
  // private and shared checks cover every IP that was not approved before.
  const ipsOf = (s: NSnap) => new Set(s.endpoints.flatMap((e) => [...e.ips]));
  const prevIps = prev ? ipsOf(prev) : new Set<string>();
  const newIps = [...ipsOf(cur)].filter((ip) => !prevIps.has(ip)).sort();
  if (prev) {
    const shared = cur.endpoints.filter((e) => prevByIdent.has(e.identifier));
    const prevShared = new Set(
      shared.flatMap((e) => [...(prevByIdent.get(e.identifier)?.ips ?? [])]),
    );
    const curShared = new Set(shared.flatMap((e) => [...e.ips]));
    const added = [...curShared].filter((ip) => !prevShared.has(ip)).length;
    if (added > 0) {
      if (prevShared.size > 0 && added === curShared.size) add('IP_REPLACED_ALL');
      else add('IP_ADDED', { n: added });
    }
  }
  const privateIps = newIps.filter(isPrivateIp);
  if (privateIps.length > 0) add('IP_PRIVATE', { ips: listed(privateIps) });

  const othersByCanonicalIp = new Map<string, string[]>();
  for (const [ip, orgs] of Object.entries(otherOrgsByIp)) {
    othersByCanonicalIp.set(normalizeIp(ip) ?? ip.toLowerCase(), orgs);
  }
  const sharedIps: string[] = [];
  const sharedOrgs = new Set<string>();
  for (const ip of newIps) {
    const others = (othersByCanonicalIp.get(ip) ?? []).filter((o) => o.toLowerCase() !== cur.orgId);
    if (others.length === 0) continue;
    sharedIps.push(ip);
    others.forEach((o) => sharedOrgs.add(o));
  }
  if (sharedIps.length > 0)
    add('IP_SHARED', { n: sharedIps.length, orgs: listed([...sharedOrgs]) });
  return out;
}
