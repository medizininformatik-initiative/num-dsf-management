/**
 * fhir.routes.ts – FHIR read endpoint for the DSF allow-list process.
 *
 * The DSF plugin dsf-process-allow-list (DownloadAllowList) reads the bundle
 * referenced in its start Task with the site's DSF client certificate:
 *   GET {base}/Bundle/{id}   Accept: application/fhir+json
 * so the reference https://<host>/fhir/Bundle/<endpoint-identifier> yields
 * the allow list scoped to that endpoint of the caller's organization.
 *
 * Authentication is mTLS only (no JWT). The certificate is resolved to an
 * organization by, in order: the SHA-512 login fingerprint, the legacy
 * SHA-256 login thumbprint, or a certificate registered in the
 * organization's certificate list (the DSF client certificate whose
 * thumbprint the allow list publishes).
 * Dependencies: express, fhir.service, audit.service, db/connection, clientCert lib
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { generateBundle, generateFullBundle } from '../services/fhir.service';
import { writeAuditLog } from '../services/audit.service';
import { extractClientCert, type ClientCertInfo } from '../lib/clientCert';

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
  if (cert.fingerprint) {
    const byFingerprint = await db('organizations')
      .where({ client_cert_fingerprint: cert.fingerprint })
      .first();
    if (byFingerprint) return { org: byFingerprint, match: 'sha512' };
  }
  const byThumbprint = await db('organizations')
    .where({ client_cert_thumbprint: cert.thumbprint })
    .first();
  if (byThumbprint) return { org: byThumbprint, match: 'sha256' };

  // A DSF BPE presents the organization's DSF client certificate, which is
  // usually not the certificate used for the browser login. Accept it when
  // exactly one organization registered it; an ambiguous match is refused.
  const owners: Array<{ organization_id: string }> = await db('certificates')
    .where({ thumbprint: cert.thumbprint })
    .distinct('organization_id');
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

// GET /fhir/Bundle/:endpointId — allow list for one endpoint of the caller's organization
fhirRouter.get('/Bundle/:endpointId', async (req: Request, res: Response) => {
  try {
    const resolved = await authenticate(req, res);
    if (!resolved) return;
    const { org, match } = resolved;

    // Scoped to the caller's own instance: generateBundle only finds the
    // endpoint among the organization's endpoints, so a certificate of org A
    // cannot read a bundle addressed to org B's endpoint (404).
    const bundle = await generateBundle(org.instance_id, req.params.endpointId);

    // Non-blocking audit; the caller is a certificate, not a user, so only a
    // masked identifier prefix is recorded and never the certificate itself.
    const cert = extractClientCert(req)!;
    writeAuditLog({
      instanceId: org.instance_id,
      resourceType: 'CERTIFICATE',
      resourceId: req.params.endpointId,
      operation: 'CREATE',
      diffJson: {
        authMethod: 'client_cert',
        match,
        idPrefix: (cert.fingerprint ?? cert.thumbprint).slice(0, 16),
      },
      ipAddress: req.ip || 'unknown',
    }).catch(() => {});

    return res.status(200).type(FHIR_JSON).send(JSON.stringify(bundle));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    if (message === 'ENDPOINT_NOT_FOUND' || message === 'ORGANIZATION_NOT_FOUND') {
      return sendOutcome(res, 404, 'not-found', message);
    }
    return sendOutcome(res, 500, 'exception', 'Internal server error');
  }
});

// GET /fhir/Bundle — network-wide allow list for any registered certificate
fhirRouter.get('/Bundle', async (req: Request, res: Response) => {
  try {
    const resolved = await authenticate(req, res);
    if (!resolved) return;
    const bundle = await generateFullBundle();
    return res.status(200).type(FHIR_JSON).send(JSON.stringify(bundle));
  } catch {
    return sendOutcome(res, 500, 'exception', 'Internal server error');
  }
});
