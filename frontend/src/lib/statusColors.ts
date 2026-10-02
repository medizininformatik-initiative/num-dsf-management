/**
 * statusColors.ts – Single source of truth for status colours.
 * - STATUS_COLOR: the certificate-status color quartet shared across the map
 *   (pins, clusters, filters, detail panel), keyed by MapOrganization's
 *   cert_status enum.
 * - TONE_CLASS: the status tones (StatusPill and other status UI) as Tailwind
 *   classes on the --tone-* scale in src/index.css, AA-contrast in light and
 *   dark mode.
 */
import type { MapOrganization } from '../api/network.api';

export const STATUS_COLOR: Record<MapOrganization['cert_status'], string> = {
  VALID: '#22c55e',
  EXPIRING: '#f5a623',
  EXPIRED: '#ef4444',
  NONE: '#94a3b8',
};

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Surface, hairline border and text colour for each tone. */
export const TONE_CLASS: Record<StatusTone, string> = {
  success: 'bg-success-surface border-success-border text-success-fg',
  warning: 'bg-warning-surface border-warning-border text-warning-fg',
  danger: 'bg-danger-surface border-danger-border text-danger-fg',
  info: 'bg-info-surface border-info-border text-info-fg',
  neutral: 'bg-neutral-surface border-neutral-border text-neutral-fg',
};
