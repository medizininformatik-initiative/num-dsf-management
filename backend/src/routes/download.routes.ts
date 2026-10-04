/**
 * download.routes.ts – FHIR-Bundle and IP-list export endpoints
 * Dependencies: auth/instance/admin middleware, bundle-versions.service,
 *               excel.service, bundle-signing.service, audit.service, sanitizeError
 *
 * /bundle             — tenant export of the current version (or `?version=`),
 *                       signed with kid + content hash, X-Bundle-Version
 * /full-bundle        — network-wide bundle of the current version (authenticated download)
 * /ip-address-list    — admin Excel export of all allow-listed IPs
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireInstanceOwnership } from '../middleware/instance.middleware';
import { requireImiAdmin } from '../middleware/admin.middleware';
import {
  getPublishedFullBundle,
  getPublishedReceiverBundle,
} from '../services/bundle-versions.service';
import { generateIpAddressListExcel } from '../services/excel.service';
import { signBundle } from '../services/bundle-signing.service';
import { writeAuditLog } from '../services/audit.service';
import { sanitizeError } from '../lib/sanitizeError';

export const downloadRouter = Router({ mergeParams: true });

downloadRouter.get('/full-bundle', requireAuth, async (req, res) => {
  try {
    // The current version, signed like the endpoint bundle, so the download
    // dialog can show the hash and signature a site needs to verify what it
    // imports. Live state only before the first stored version.
    const { json, signature, contentHash, versionNumber } = await getPublishedFullBundle();
    if (versionNumber) res.setHeader('X-Bundle-Version', String(versionNumber));
    res.setHeader('Content-Type', 'application/fhir+json');
    res.setHeader('Content-Disposition', 'attachment; filename="dsf-allow-list-bundle.json"');
    res.setHeader('X-Bundle-Signature', signature);
    res.setHeader('X-Content-Hash', contentHash);

    // Log every full-bundle download. The endpoint exposes the entire
    // federation map (every approved org's identifier, endpoints, IPs,
    // cert thumbprints) to any authenticated caller — without an audit
    // trail there is no signal that a compromised non-admin account is
    // exfiltrating the federation graph.
    writeAuditLog({
      userEmail: req.user!.email,
      resourceType: 'AUTH',
      operation: 'CREATE',
      diffJson: { action: 'full_bundle_download', byteSize: json.length, contentHash },
      ipAddress: req.ip || 'unknown',
    }).catch(() => {});

    res.send(json);
  } catch {
    res
      .status(500)
      .json({ error: { code: 'BUNDLE_FAIL', message: 'Failed to generate allow-list bundle.' } });
  }
});

downloadRouter.get('/bundle', requireAuth, requireInstanceOwnership, async (req, res) => {
  const endpointId = req.query.endpointId as string;
  if (!endpointId) {
    return res
      .status(400)
      .json({ error: { code: 'MISSING_ENDPOINT', message: 'endpointId required' } });
  }
  const versionParam = req.query.version;
  if (versionParam !== undefined && !/^[1-9]\d{0,9}$/.test(String(versionParam))) {
    return res
      .status(400)
      .json({ error: { code: 'INVALID_VERSION', message: 'version must be a positive integer' } });
  }
  try {
    const { bundle, version } = await getPublishedReceiverBundle(
      req.instance!.id,
      endpointId,
      versionParam === undefined ? undefined : Number(versionParam),
    );
    const { json, signature, contentHash } = signBundle(bundle);
    if (version) res.setHeader('X-Bundle-Version', String(version.number));
    res.setHeader('Content-Type', 'application/fhir+json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="allowlist-bundle-${endpointId}.json"`,
    );
    res.setHeader('X-Bundle-Signature', signature);
    res.setHeader('X-Content-Hash', contentHash);

    writeAuditLog({
      userEmail: req.user!.email,
      instanceId: req.instance!.id,
      resourceType: 'CERTIFICATE',
      resourceId: endpointId,
      operation: 'CREATE',
      diffJson: { contentHash, action: 'bundle_download' },
      ipAddress: req.ip || 'unknown',
    }).catch(() => {});

    // Send the exact bytes that were hashed and signed. res.json(bundle) would
    // re-serialize independently, risking a body that no longer matches
    // X-Content-Hash.
    res.type('application/fhir+json').send(json);
  } catch (err: unknown) {
    res.status(404).json({ error: sanitizeError(err) });
  }
});

downloadRouter.get('/ip-address-list', requireAuth, requireImiAdmin, async (req, res) => {
  try {
    const buffer = await generateIpAddressListExcel();
    const date = new Date().toISOString().split('T')[0];
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="dsf-ip-address-list-${date}.xlsx"`);
    res.send(buffer);
  } catch (err: unknown) {
    res.status(500).json({ error: { code: 'EXPORT_FAILED', message: 'Export failed' } });
  }
});
