/**
 * admin-stats.service.ts – summary numbers for the admin overview: sites,
 * approval requests, allow-list freshness and open incidents.
 *
 * A "site" is one organizations row (one per instance). All figures come from
 * a handful of aggregate queries; nothing is counted per organization in a loop.
 * Dependencies: db/connection, bundle-versions.service (currentVersionNumber),
 *               fhir.service (countPublishedOrganizations)
 */
import { db } from '../db/connection';
import { currentVersionNumber } from './bundle-versions.service';
import { countPublishedOrganizations } from './fhir.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AdminStats {
  sites: {
    total: number;
    active: number;
    withLoginCertificate: number;
    everLoggedIn: number;
    loggedInLast24h: number;
    published: number;
  };
  requests: {
    pending: number;
    approved: number;
    rejected: number;
    withdrawn: number;
    draft: number;
    approvedLast24h: number;
  };
  allowList: {
    currentVersion: number | null;
    currentPublishedAt: string | null;
    sitesUpToDate: number;
    sitesNeverFetched: number;
  };
  incidents: {
    open: number;
  };
}

/**
 * Last login per site. A login is the site's own: certificate logins carry the site's
 * instance, OTP/TOTP logins only the owner's e-mail. An admin opening a site
 * (admin_instance_access, also written as LOGIN) is no login of that site.
 */
function siteLogins() {
  const withInstance = db('audit_logs as a')
    .join('organizations as o', 'o.instance_id', 'a.instance_id')
    .where('a.operation', 'LOGIN')
    .whereRaw(
      "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.diff_json, '$.action')), '') <> 'admin_instance_access'",
    )
    .select('o.identifier', 'a.timestamp as ts');
  const byOwner = db('audit_logs as a')
    .join('users as u', 'u.email', 'a.user_email')
    .join('instances as i', 'i.user_id', 'u.id')
    .join('organizations as o', 'o.instance_id', 'i.id')
    .where('a.operation', 'LOGIN')
    .whereNull('a.instance_id')
    .select('o.identifier', 'a.timestamp as ts');
  return db
    .from(withInstance.unionAll([byOwner]).as('l'))
    .groupBy('identifier')
    .select('identifier', db.raw('MAX(ts) AS last_login'));
}

type CountRow = { n: number | string } | undefined;
const num = (row: CountRow): number => Number(row?.n ?? 0);

export async function getAdminStats(now: Date = new Date()): Promise<AdminStats> {
  const since = new Date(now.getTime() - DAY_MS);
  const current = await currentVersionNumber();

  const [
    siteRow,
    withLogin,
    loginRows,
    published,
    statusRows,
    approvedRecent,
    version,
    upToDate,
    neverFetched,
    openIncidents,
  ] = await Promise.all([
    db('organizations')
      .select(db.raw('COUNT(*) AS total'), db.raw('COALESCE(SUM(active = 1), 0) AS active'))
      .first(),
    db('org_login_certificates').countDistinct({ n: 'organization_id' }).first(),
    siteLogins(),
    countPublishedOrganizations(),
    db('approval_requests').select('status').count({ n: '*' }).groupBy('status'),
    db('approval_requests')
      .where('status', 'APPROVED')
      .where('resolved_at', '>=', since)
      .count({ n: '*' })
      .first(),
    current === null
      ? Promise.resolve(undefined)
      : db('bundle_versions').where({ version_number: current }).first('created_at'),
    current === null
      ? Promise.resolve(undefined)
      : db('allowlist_fetches as f')
          .join('organizations as o', 'o.instance_id', 'f.instance_id')
          .where('f.version_number', '>=', current)
          .count({ n: '*' })
          .first(),
    db('organizations as o')
      .leftJoin('allowlist_fetches as f', 'f.instance_id', 'o.instance_id')
      .whereNull('f.instance_id')
      .count({ n: '*' })
      .first(),
    // Open = not yet closed: REPORTED (unconfirmed) and CONFIRMED. CLOSED and FALSE_ALARM are done.
    db('incidents')
      .whereIn('status', ['REPORTED', 'CONFIRMED'])
      .whereNull('archived_at')
      .count({ n: '*' })
      .first(),
  ]);

  const byStatus = new Map(
    (statusRows as Array<{ status: string; n: number | string }>).map((r) => [
      r.status,
      Number(r.n),
    ]),
  );
  const lastLogins = loginRows as Array<{ last_login: Date | string }>;

  return {
    sites: {
      total: Number(siteRow?.total ?? 0),
      active: Number(siteRow?.active ?? 0),
      withLoginCertificate: num(withLogin as CountRow),
      everLoggedIn: lastLogins.length,
      // audit_logs.timestamp is stored in UTC like every DATETIME here.
      loggedInLast24h: lastLogins.filter((r) => new Date(r.last_login) >= since).length,
      published,
    },
    requests: {
      pending: byStatus.get('PENDING') ?? 0,
      approved: byStatus.get('APPROVED') ?? 0,
      rejected: byStatus.get('REJECTED') ?? 0,
      withdrawn: byStatus.get('WITHDRAWN') ?? 0,
      draft: byStatus.get('DRAFT') ?? 0,
      approvedLast24h: num(approvedRecent as CountRow),
    },
    allowList: {
      currentVersion: current,
      currentPublishedAt: version ? new Date(version.created_at).toISOString() : null,
      sitesUpToDate: num(upToDate as CountRow),
      sitesNeverFetched: num(neverFetched as CountRow),
    },
    incidents: { open: num(openIncidents as CountRow) },
  };
}
