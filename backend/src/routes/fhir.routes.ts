/**
 * fhir.routes.ts – FHIR read endpoint for the DSF allow-list process.
 *
 * The DSF plugin dsf-process-allow-list (DownloadAllowList) reads the bundle
 * referenced in its start Task with the site's DSF client certificate:
 *   GET {base}/Bundle/{id}   Accept: application/fhir+json
 * so the reference https://<host>/fhir/Bundle/<endpoint-identifier> yields
 * the allow list scoped to that endpoint of the caller's organization.
 * https://<host>/fhir/Bundle/mine is the same for every site: the endpoint is
 * derived from the certificate's organization (its only endpoint, else the
 * only one whose identifier starts with "fhir."; otherwise 409 and the site
 * uses the per-endpoint URL). That is
 * always the CURRENT bundle version (Bundle.meta.versionId, ETag, Last-Modified);
 * _history lists all versions and _history/{vid} reads an old one.
 *
 * Authentication is mTLS only (no JWT). The certificate is resolved to an
 * organization by, in order: the SHA-512 login certificate (org_login_certificates), the legacy
 * SHA-256 login thumbprint, or a certificate registered in the
 * organization's certificate list (the DSF client certificate whose
 * thumbprint the allow list publishes). A certificate blocked by an incident
 * (or one whose SHA-512 cannot be computed) is refused before any lookup.
 * Dependencies: express, fhir.service, audit.service, incident-blocks.service,
 *               db/connection, clientCert lib
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { resolveReceiver } from '../services/fhir.service';
import {
  getPublishedFullBundle,
  getPublishedReceiverBundle,
  listReceiverHistory,
} from '../services/bundle-versions.service';
import { writeAuditLog } from '../services/audit.service';
import { recordAllowListFetchSafe } from '../services/allowlist-freshness.service';
import { extractClientCert, type ClientCertInfo } from '../lib/clientCert';
import { isFingerprintBlocked } from '../services/incident-blocks.service';

export const fhirRouter = Router();

const FHIR_JSON = 'application/fhir+json';

type CertMatch = 'sha512' | 'sha256' | 'certificate';

interface ResolvedOrg {
  org: { identifier: string; instance_id: string };
  match: CertMatch;
}

/**
 * Reply with a FHIR OperationOutcome. The DSF client parses error bodies as
 * OperationOutcome, so the media type must be a FHIR one.
 */
function sendOutcome(res: Response, status: number, code: string, diagnostics: string) {
  return res
    .status(status)
    .type(FHIR_JSON)
    .send(
      JSON.stringify({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code, diagnostics }],
      }),
    );
}

async function findOrgByClientCert(cert: ClientCertInfo): Promise<ResolvedOrg | null> {
  // Blocks are kept by SHA-512; without it a block could not be checked, and
  // the SHA-256 lookups below must not let a blocked certificate through.
  if (!cert.fingerprint || (await isFingerprintBlocked(cert.fingerprint))) return null;
  const byFingerprint = await db('organizations as o')
    .join('org_login_certificates as l', 'l.organization_id', 'o.identifier')
    .where('l.fingerprint', cert.fingerprint)
    .select('o.*')
    .first();
  if (byFingerprint) return { org: byFingerprint, match: 'sha512' };
  // parseCertificate stores the SHA-256 in upper case, extractClientCert
  // computes it in lower case; match both instead of relying on collation.
  const thumbprints = [cert.thumbprint, cert.thumbprint.toUpperCase()];
  const owners: Array<{ organization_id: string }> = await db('certificates')
    .whereIn('thumbprint', thumbprints)
    .distinct('organization_id');

  // client_cert_thumbprint is tenant-editable and not unique: identify the
  // site by it only when exactly one organization claims the thumbprint and no
  // OTHER organization registered the certificate. Otherwise (ambiguous, or a
  // claim on another site's certificate) fall through to the certificate list.
  const byThumbprint = await db('organizations')
    .whereIn('client_cert_thumbprint', thumbprints)
    .limit(2);
  if (
    byThumbprint.length === 1 &&
    owners.every((o) => o.organization_id === byThumbprint[0].identifier)
  ) {
    return { org: byThumbprint[0], match: 'sha256' };
  }

  // A DSF BPE presents the organization's DSF client certificate, which is
  // usually not the certificate used for the browser login. Accept it when
  // exactly one organization registered it; an ambiguous match is refused.
  if (owners.length !== 1) return null;
  const byCertificate = await db('organizations')
    .where({ identifier: owners[0].organization_id })
    .first();
  return byCertificate ? { org: byCertificate, match: 'certificate' } : null;
}

/**
 * Shared mTLS gate: only a proxy-verified handshake is trusted.
 * extractClientCert enforces X-Client-Verify === 'SUCCESS' as well; checking
 * here too keeps a forged X-Client-Cert away from every lookup.
 */
async function authenticate(req: Request, res: Response): Promise<ResolvedOrg | null> {
  const cert = req.headers['x-client-verify'] === 'SUCCESS' ? extractClientCert(req) : null;
  if (!cert) {
    sendOutcome(res, 401, 'security', 'Client certificate required');
    return null;
  }
  const resolved = await findOrgByClientCert(cert);
  if (!resolved) {
    sendOutcome(res, 403, 'forbidden', 'Client certificate not registered');
    return null;
  }
  return resolved;
}

const NOT_FOUND_ERRORS = new Set([
  'ENDPOINT_NOT_FOUND',
  'ORGANIZATION_NOT_FOUND',
  'VERSION_NOT_FOUND',
]);

function handleError(res: Response, err: unknown) {
  const message = err instanceof Error ? err.message : 'unknown';
  if (NOT_FOUND_ERRORS.has(message)) return sendOutcome(res, 404, 'not-found', message);
  return sendOutcome(res, 500, 'exception', 'Internal server error');
}

/** Version headers; a conditional GET with a matching ETag answers 304. */
function setVersionHeaders(res: Response, version: { number: number; createdAt: Date } | null) {
  if (!version) return;
  res.setHeader('ETag', `W/"${version.number}"`);
  res.setHeader('Last-Modified', version.createdAt.toUTCString());
}

/** Non-blocking audit; the caller is a certificate, not a user, so only a
 * masked identifier prefix is recorded and never the certificate itself. */
function auditRead(
  req: Request,
  resolved: ResolvedOrg,
  extra: Record<string, unknown> = {},
  endpointId: string = req.params.endpointId,
) {
  const cert = extractClientCert(req)!;
  writeAuditLog({
    instanceId: resolved.org.instance_id,
    resourceType: 'CERTIFICATE',
    resourceId: endpointId,
    operation: 'CREATE',
    diffJson: {
      authMethod: 'client_cert',
      match: resolved.match,
      idPrefix: (cert.fingerprint ?? cert.thumbprint).slice(0, 16),
      ...extra,
    },
    ipAddress: req.ip || 'unknown',
  }).catch(() => {});
}

// Scoped to the caller's own instance: the endpoint is only found among the
// organization's endpoints, so a certificate of org A cannot read a bundle
// addressed to org B's endpoint (404).

// GET /fhir/Bundle/mine — the same as /Bundle/<endpoint> for the endpoint derived
// from the certificate's organization: its only endpoint, else the only one
// whose identifier starts with "fhir."; otherwise 409 AMBIGUOUS_ENDPOINT.
// Registered before /Bundle/:endpointId so "mine" is not an endpoint id.
fhirRouter.get('/Bundle/mine', async (req: Request, res: Response) => {
  try {
    const resolved = await authenticate(req, res);
    if (!resolved) return;
    const rows: Array<{ identifier: string }> = await db('endpoints')
      .where({ organization_id: resolved.org.identifier })
      .orderBy('identifier')
      .select('identifier');
    const ids = rows.map((r) => r.identifier);
    if (ids.length === 0) {
      return sendOutcome(res, 404, 'not-found', 'ENDPOINT_NOT_FOUND');
    }
    const fhirIds = ids.filter((id) => id.startsWith('fhir.'));
    const endpointId = ids.length === 1 ? ids[0] : fhirIds.length === 1 ? fhirIds[0] : null;
    if (!endpointId) {
      return sendOutcome(
        res,
        409,
        'conflict',
        `AMBIGUOUS_ENDPOINT: use /fhir/Bundle/<endpoint>, one of: ${ids.join(', ')}`,
      );
    }
    const { bundle, version } = await getPublishedReceiverBundle(
      resolved.org.instance_id,
      endpointId,
    );
    auditRead(
      req,
      resolved,
      { ...(version ? { version: version.number } : {}), mine: true },
      endpointId,
    );
    setVersionHeaders(res, version);
    res.status(200).type(FHIR_JSON).send(JSON.stringify(bundle));
    recordAllowListFetchSafe(resolved.org.instance_id, version?.number, 'DSF');
    return;
  } catch (err: unknown) {
    return handleError(res, err);
  }
});

// GET /fhir/Bundle/:endpointId — the CURRENT allow list for one endpoint of the
// caller's organization: the receiver view of the latest bundle version.
fhirRouter.get('/Bundle/:endpointId', async (req: Request, res: Response) => {
  try {
    const resolved = await authenticate(req, res);
    if (!resolved) return;
    const { bundle, version } = await getPublishedReceiverBundle(
      resolved.org.instance_id,
      req.params.endpointId,
    );
    auditRead(req, resolved, version ? { version: version.number } : {});
    setVersionHeaders(res, version);
    // Express answers 304 here when If-None-Match matches the ETag; either way
    // the site holds this (current) version.
    res.status(200).type(FHIR_JSON).send(JSON.stringify(bundle));
    recordAllowListFetchSafe(resolved.org.instance_id, version?.number, 'DSF');
    return;
  } catch (err: unknown) {
    return handleError(res, err);
  }
});

// GET /fhir/Bundle/:endpointId/_history — FHIR history Bundle, newest first,
// one entry per version without the resource; read a version via _history/{vid}.
fhirRouter.get('/Bundle/:endpointId/_history', async (req: Request, res: Response) => {
  try {
    const resolved = await authenticate(req, res);
    if (!resolved) return;
    const endpointId = req.params.endpointId;
    await resolveReceiver(resolved.org.instance_id, endpointId);
    const count = Math.min(Math.max(parseInt(String(req.query._count), 10) || 50, 1), 200);
    const entries = await listReceiverHistory({ limit: count });
    const host = req.get('x-forwarded-host') || req.get('host');
    const base = `${req.protocol}://${host}/fhir`;
    const relative = `Bundle/${encodeURIComponent(endpointId)}`;
    const bundle = {
      resourceType: 'Bundle',
      type: 'history',
      ...(entries.length > 0
        ? {
            entry: entries.map((e) => ({
              fullUrl: `${base}/${relative}/_history/${e.versionNumber}`,
              request: { method: 'GET', url: `${relative}/_history/${e.versionNumber}` },
              response: {
                status: '200',
                etag: `W/"${e.versionNumber}"`,
                lastModified: e.createdAt.toISOString(),
              },
            })),
          }
        : {}),
    };
    auditRead(req, resolved, { history: true });
    return res.status(200).type(FHIR_JSON).send(JSON.stringify(bundle));
  } catch (err: unknown) {
    return handleError(res, err);
  }
});

// GET /fhir/Bundle/:endpointId/_history/:vid — receiver view of one old version.
fhirRouter.get('/Bundle/:endpointId/_history/:vid', async (req: Request, res: Response) => {
  try {
    const resolved = await authenticate(req, res);
    if (!resolved) return;
    if (!/^[1-9]\d{0,9}$/.test(req.params.vid)) {
      return sendOutcome(res, 404, 'not-found', 'VERSION_NOT_FOUND');
    }
    const { bundle, version } = await getPublishedReceiverBundle(
      resolved.org.instance_id,
      req.params.endpointId,
      Number(req.params.vid),
    );
    auditRead(req, resolved, { version: version?.number });
    setVersionHeaders(res, version);
    res.status(200).type(FHIR_JSON).send(JSON.stringify(bundle));
    recordAllowListFetchSafe(resolved.org.instance_id, version?.number, 'DSF');
    return;
  } catch (err: unknown) {
    return handleError(res, err);
  }
});

// GET /fhir/Bundle — network-wide allow list for any registered certificate
fhirRouter.get('/Bundle', async (req: Request, res: Response) => {
  try {
    const resolved = await authenticate(req, res);
    if (!resolved) return;
    const { json } = await getPublishedFullBundle();
    return res.status(200).type(FHIR_JSON).send(json);
  } catch {
    return sendOutcome(res, 500, 'exception', 'Internal server error');
  }
});
