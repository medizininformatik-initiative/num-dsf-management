/**
 * mapLabels.ts – i18n keys shared by the network map components, so the
 * certificate-status wording stays identical on pins, filters and legend.
 * Dependencies: network.api types.
 */
import type { MapOrganization } from '../../api/network.api';

export const CERT_STATUSES: MapOrganization['cert_status'][] = [
  'VALID',
  'EXPIRING',
  'EXPIRED',
  'NONE',
];

export const CERT_STATUS_LABEL_KEY: Record<
  MapOrganization['cert_status'],
  'mapStatusValid' | 'mapStatusExpiring' | 'mapStatusExpired' | 'mapStatusNone'
> = {
  VALID: 'mapStatusValid',
  EXPIRING: 'mapStatusExpiring',
  EXPIRED: 'mapStatusExpired',
  NONE: 'mapStatusNone',
};
