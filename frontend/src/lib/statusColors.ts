/**
 * statusColors.ts – Single source of truth for status colours.
 * - CERT_STATUS_TONE / certStatusColor: the certificate status of a map
 *   organization expressed in the shared status tones, so pins, clusters,
 *   filters and the detail panel use the same AA-contrast colours as
 *   StatusPill in light and dark mode.
 * - TONE_CLASS: the status tones (StatusPill and other status UI) as Tailwind
 *   classes on the --tone-* scale in src/index.css, AA-contrast in light and
 *   dark mode.
 */
import type { MapOrganization } from '../api/network.api';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type CertStatus = MapOrganization['cert_status'];

/** Tone of each certificate status of a map organization. */
export const CERT_STATUS_TONE: Record<CertStatus, StatusTone> = {
  VALID: 'success',
  EXPIRING: 'warning',
  EXPIRED: 'danger',
  NONE: 'neutral',
};

/** CSS colour (the tone's foreground) for a certificate status. */
export function certStatusColor(status: CertStatus): string {
  return `var(--tone-${CERT_STATUS_TONE[status]}-fg)`;
}

/** Surface, hairline border and text colour for each tone. */
export const TONE_CLASS: Record<StatusTone, string> = {
  success: 'bg-success-surface border-success-border text-success-fg',
  warning: 'bg-warning-surface border-warning-border text-warning-fg',
  danger: 'bg-danger-surface border-danger-border text-danger-fg',
  info: 'bg-info-surface border-info-border text-info-fg',
  neutral: 'bg-neutral-surface border-neutral-border text-neutral-fg',
};
