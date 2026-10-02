/**
 * readiness.ts – The one submit-readiness rule. The onboarding wizard, the
 * right-panel checklist and the approval modal all derive their state here, so
 * they can never disagree about what is still missing.
 *
 * An instance is ready to submit when it has
 *   - an active organization,
 *   - a contact with the MEDIC role,
 *   - at least one endpoint,
 *   - at least one certificate that has not expired (certValidity),
 *   - at least one membership.
 * It counts as submitted only while the latest request is PENDING or APPROVED;
 * a REJECTED or DRAFT request has to be sent again.
 *
 * Backend: submitApproval (backend/src/services/approval.service.ts) refuses a
 * second PENDING request (APPROVAL_ALREADY_PENDING) and an instance without an
 * organization (ORGANIZATION_NOT_FOUND). Both are covered here (`pending`
 * blocks `canSubmit`, the organization step needs one); the other steps are
 * enforced by the UI only.
 * Dependencies: lib/certStatus, lib/parseJsonArray, lib/motion, stores/canvas.store
 */
import type { TranslationKey } from '../i18n/en';
import { certValidity } from './certStatus';
import { parseJsonArray } from './parseJsonArray';
import { scrollIntoViewSafe } from './motion';
import { useCanvasStore } from '../stores/canvas.store';

/** One step per entity card; the key is also the card's canvas id. */
export type ReadinessKey =
  | 'organization'
  | 'contacts'
  | 'endpoints'
  | 'certificates'
  | 'memberships';

export interface ReadinessItem {
  key: ReadinessKey;
  done: boolean;
}

export interface Readiness {
  items: ReadinessItem[];
  /** Every data step is done. */
  ready: boolean;
  /** Number of data steps still open. */
  openCount: number;
  /** The latest request is PENDING or APPROVED. */
  submitted: boolean;
  /** The latest request is PENDING, so the backend refuses another submit. */
  pending: boolean;
  /** Ready and nothing pending: a request may be submitted. */
  canSubmit: boolean;
}

export interface ReadinessInput {
  organization?: { active?: unknown } | null;
  contacts?: { types?: unknown }[];
  endpoints?: unknown[];
  certificates?: { valid_until?: string | null }[];
  memberships?: unknown[];
  /** Latest approval request (GET /approval/status); null when there is none. */
  approval?: { status?: string } | null;
}

/** Label of each step, shared by every readiness view. */
export const READINESS_LABEL: Record<ReadinessKey, TranslationKey> = {
  organization: 'readinessOrganization',
  contacts: 'readinessContacts',
  endpoints: 'readinessEndpoints',
  certificates: 'readinessCertificates',
  memberships: 'readinessMemberships',
};

/** Material Symbol of each step. */
export const READINESS_ICON: Record<ReadinessKey, string> = {
  organization: 'corporate_fare',
  contacts: 'contact_phone',
  endpoints: 'hub',
  certificates: 'verified_user',
  memberships: 'groups',
};

/** At least one contact carries the MEDIC role (types may be JSON or an array). */
export function hasMedicContact(contacts: { types?: unknown }[] = []): boolean {
  return contacts.some((c) => parseJsonArray(c.types).includes('MEDIC'));
}

/** At least one certificate has not expired yet. */
export function hasValidCertificate(certificates: { valid_until?: string | null }[] = []): boolean {
  return certificates.some(
    (c) => !!c.valid_until && certValidity(c.valid_until).state !== 'expired',
  );
}

export function deriveReadiness(input: ReadinessInput): Readiness {
  const items: ReadinessItem[] = [
    // MySQL returns the BOOLEAN column as 1/0, so test truthiness, not === true.
    { key: 'organization', done: !!input.organization && Boolean(input.organization.active) },
    { key: 'contacts', done: hasMedicContact(input.contacts) },
    { key: 'endpoints', done: (input.endpoints?.length ?? 0) > 0 },
    { key: 'certificates', done: hasValidCertificate(input.certificates) },
    { key: 'memberships', done: (input.memberships?.length ?? 0) > 0 },
  ];
  const openCount = items.filter((i) => !i.done).length;
  const status = input.approval?.status;
  const pending = status === 'PENDING';
  const ready = openCount === 0;
  return {
    items,
    ready,
    openCount,
    submitted: pending || status === 'APPROVED',
    pending,
    canSubmit: ready && !pending,
  };
}

/**
 * Point the user at a step's card: highlight it through the canvas store and
 * scroll it into view (instantly under Reduce Motion).
 */
export function revealReadinessCard(key: ReadinessKey): void {
  useCanvasStore.getState().highlightEntity(key);
  scrollIntoViewSafe(document.getElementById(`card-${key}`), { block: 'center' });
}
