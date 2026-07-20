/**
 * fhir.routes.ts – FHIR-compatible Bundle endpoint for DSF process
 * Authenticates via client certificate (mTLS): matches the SHA-512
 * fingerprint first, falling back to the SHA-256 thumbprint for
 * organizations onboarded before the SHA-512 migration.
 * No JWT auth required — this is a machine-to-machine endpoint.
 * Dependencies: express, fhir.service, audit.service, db/connection, clientCert lib
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { generateBundle, generateFullBundle } from '../services/fhir.service';
import { writeAuditLog } from '../services/audit.service';
import { extractClientCert } from '../lib/clientCert';

export const fhirRouter = Router();

/**
 * Lookup the organization registered for the given client cert: match the
 * SHA-512 fingerprint first, then fall back to the SHA-256 thumbprint so
 * organizations onboarded before the SHA-512 migration keep working.
 * Returns the org row or null if neither matches.
 */
async function findOrgByClientCert(cert: { fingerprint: string | null; thumbprint: string }) {
  if (cert.fingerprint) {
    // Coalesce the resolved row, not the (always-truthy) query promise.
    const byFingerprint = await db('organizations')
      .where({ client_cert_fingerprint: cert.fingerprint })
      .first();
    if (byFingerprint) return byFingerprint;
  }
  const byThumbprint = await db('organizations')
    .where({ client_cert_thumbprint: cert.thumbprint })
    .first();
  return byThumbprint ?? null;
}

// GET /fhir/Bundle/:endpointId — Fetch a specific bundle by endpoint identifier
fhirRouter.get('/Bundle/:endpointId', async (req: Request, res: Response) => {
  try {
    // Only an nginx-verified mTLS handshake is trusted. extractClientCert
    // already enforces X-Client-Verify === 'SUCCESS'; reject here too so a
    // forged X-Client-Cert never reaches the thumbprint lookup.
    if (req.headers['x-client-verify'] !== 'SUCCESS') {
      return res.status(401).json({
        resourceType: 'OperationOutcome',
        issue: [
          { severity: 'error', code: 'security', diagnostics: 'Client certificate required' },
        ],
      });
    }
    const cert = extractClientCert(req);
    if (!cert) {
      return res.status(401).json({
        resourceType: 'OperationOutcome',
        issue: [
          { severity: 'error', code: 'security', diagnostics: 'Client certificate required' },
        ],
      });
    }

    const org = await findOrgByClientCert(cert);
    if (!org) {
      return res.status(403).json({
        resourceType: 'OperationOutcome',
        issue: [
          {
            severity: 'error',
            code: 'forbidden',
            diagnostics: 'Client certificate not registered',
          },
        ],
      });
    }
    // Deterministic given client_cert_fingerprint is UNIQUE: if this org's
    // fingerprint equals the presented cert's, the fingerprint lookup above
    // is what found it — the thumbprint fallback only runs when that lookup
    // returns no row.
    const match =
      cert.fingerprint && org.client_cert_fingerprint === cert.fingerprint ? 'sha512' : 'sha256';

    // Scope the bundle to the caller's own instance + the requested endpoint.
    // generateBundle filters endpoints by `(instance_id, identifier)`, so a
    // cert registered for org A cannot pull a bundle for org B's endpoint —
    // the lookup returns ENDPOINT_NOT_FOUND and the catch below maps it to
    // a 404. Previously this route returned generateFullBundle() ignoring
    // :endpointId entirely, so ANY cert could enumerate every endpoint in
    // the federation through this path.
    const bundle = await generateBundle(org.instance_id, req.params.endpointId);

    // Audit: record the download (non-blocking — failure must not disrupt the response).
    // userEmail intentionally omitted — this caller is a client cert, not a user.
    // The matched id goes into diffJson, masked to a 16-char prefix, so
    // audit-by-user queries stay clean (filtering 'cert:...' polluted the
    // user_email column previously) and the full cert/pem is never logged.
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

    res.setHeader('Content-Type', 'application/fhir+json');
    return res.json(bundle);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    if (message === 'ENDPOINT_NOT_FOUND' || message === 'ORGANIZATION_NOT_FOUND') {
      return res.status(404).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'not-found', diagnostics: message }],
      });
    }
    return res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'exception', diagnostics: 'Internal server error' }],
    });
  }
});

// GET /fhir/Bundle — Search by client cert; returns first endpoint bundle wrapped in a searchset
fhirRouter.get('/Bundle', async (req: Request, res: Response) => {
  try {
    // Only an nginx-verified mTLS handshake is trusted (see :endpointId route).
    if (req.headers['x-client-verify'] !== 'SUCCESS') {
      return res.status(401).json({
        resourceType: 'OperationOutcome',
        issue: [
          { severity: 'error', code: 'security', diagnostics: 'Client certificate required' },
        ],
      });
    }
    const cert = extractClientCert(req);
    if (!cert) {
      return res.status(401).json({
        resourceType: 'OperationOutcome',
        issue: [
          { severity: 'error', code: 'security', diagnostics: 'Client certificate required' },
        ],
      });
    }

    const org = await findOrgByClientCert(cert);
    if (!org) {
      return res.status(403).json({
        resourceType: 'OperationOutcome',
        issue: [
          {
            severity: 'error',
            code: 'forbidden',
            diagnostics: 'Client certificate not registered',
          },
        ],
      });
    }

    const bundle = await generateFullBundle();

    res.setHeader('Content-Type', 'application/fhir+json');
    return res.json(bundle);
  } catch {
    return res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'exception', diagnostics: 'Internal server error' }],
    });
  }
});
