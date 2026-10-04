/**
 * readiness.test.ts — the single submit-readiness rule shared by the wizard,
 * the right-panel checklist and the approval modal: active organization, MEDIC
 * contact, endpoint, non-expired certificate and membership; "submitted" only
 * for a PENDING or APPROVED latest request; no submit while one is pending.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  deriveReadiness,
  hasMedicContact,
  hasValidCertificate,
  revealReadinessCard,
  type ReadinessInput,
} from '../readiness';
import { useCanvasStore } from '../../stores/canvas.store';

const future = '2999-01-01';
const past = '2000-01-01';

/** Every data step satisfied; tests break one thing at a time. */
function complete(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    organization: { active: true },
    contacts: [{ types: ['MEDIC'] }],
    endpoints: [{}],
    certificates: [{ valid_until: future }],
    memberships: [{}],
    ...overrides,
  };
}

const done = (input: ReadinessInput, key: string) =>
  deriveReadiness(input).items.find((i) => i.key === key)!.done;

afterEach(() => {
  useCanvasStore.setState({ highlightedEntity: null, highlightedKey: null });
});

describe('deriveReadiness', () => {
  it('is ready only when all five data steps hold', () => {
    const r = deriveReadiness(complete());
    expect(r.ready).toBe(true);
    expect(r.openCount).toBe(0);
    expect(r.items.map((i) => i.key)).toEqual([
      'organization',
      'contacts',
      'endpoints',
      'certificates',
      'memberships',
    ]);
    expect(r.items.every((i) => i.done)).toBe(true);
  });

  it('requires an active organization (MySQL 1/0 and booleans)', () => {
    expect(done(complete({ organization: { active: 1 } }), 'organization')).toBe(true);
    expect(done(complete({ organization: { active: 0 } }), 'organization')).toBe(false);
    expect(done(complete({ organization: { active: false } }), 'organization')).toBe(false);
    expect(done(complete({ organization: null }), 'organization')).toBe(false);
  });

  it('requires a MEDIC contact, not just any contact', () => {
    expect(done(complete({ contacts: [{ types: ['DSF_ADMIN'] }] }), 'contacts')).toBe(false);
    expect(done(complete({ contacts: [{ types: '["SECURITY","MEDIC"]' }] }), 'contacts')).toBe(
      true,
    );
    expect(done(complete({ contacts: [] }), 'contacts')).toBe(false);
  });

  it('does not count an expired-only certificate', () => {
    expect(done(complete({ certificates: [{ valid_until: past }] }), 'certificates')).toBe(false);
    expect(
      done(
        complete({ certificates: [{ valid_until: past }, { valid_until: future }] }),
        'certificates',
      ),
    ).toBe(true);
  });

  it('empty input is not ready and reports five open items', () => {
    const r = deriveReadiness({});
    expect(r.ready).toBe(false);
    expect(r.openCount).toBe(5);
    expect(r.submitted).toBe(false);
    expect(r.canSubmit).toBe(false);
  });

  it('counts only a PENDING or APPROVED request as submitted', () => {
    expect(deriveReadiness(complete({ approval: { status: 'PENDING' } })).submitted).toBe(true);
    expect(deriveReadiness(complete({ approval: { status: 'APPROVED' } })).submitted).toBe(true);
    expect(deriveReadiness(complete({ approval: { status: 'REJECTED' } })).submitted).toBe(false);
    expect(deriveReadiness(complete({ approval: { status: 'DRAFT' } })).submitted).toBe(false);
    expect(deriveReadiness(complete({ approval: null })).submitted).toBe(false);
  });

  it('blocks submitting while a request is pending, like the backend', () => {
    const pending = deriveReadiness(complete({ approval: { status: 'PENDING' } }));
    expect(pending.ready).toBe(true);
    expect(pending.pending).toBe(true);
    expect(pending.canSubmit).toBe(false);
    // A rejected or approved request may be followed by a new one.
    expect(deriveReadiness(complete({ approval: { status: 'REJECTED' } })).canSubmit).toBe(true);
    expect(deriveReadiness(complete({ approval: { status: 'APPROVED' } })).canSubmit).toBe(true);
  });
});

describe('deriveReadiness — withdrawal', () => {
  it('lets a deactivated organization submit without the publishing steps', () => {
    const r = deriveReadiness({ organization: { active: 0 }, contacts: [], certificates: [] });
    expect(r.withdrawal).toBe(true);
    expect(r.ready).toBe(false);
    expect(r.canSubmit).toBe(true);
  });

  it('still blocks a second request while one is pending', () => {
    const r = deriveReadiness({ organization: { active: false }, approval: { status: 'PENDING' } });
    expect(r.withdrawal).toBe(true);
    expect(r.canSubmit).toBe(false);
  });

  it('is not a withdrawal without an organization or for an active one', () => {
    expect(deriveReadiness({}).withdrawal).toBe(false);
    expect(deriveReadiness(complete()).withdrawal).toBe(false);
  });
});

describe('readiness helpers', () => {
  it('hasMedicContact and hasValidCertificate tolerate missing input', () => {
    expect(hasMedicContact()).toBe(false);
    expect(hasValidCertificate()).toBe(false);
    expect(hasValidCertificate([{ valid_until: null }])).toBe(false);
  });

  it('revealReadinessCard highlights the card and scrolls it into view', () => {
    const card = document.createElement('div');
    card.id = 'card-endpoints';
    const scroll = vi.fn();
    card.scrollIntoView = scroll;
    document.body.appendChild(card);

    revealReadinessCard('endpoints');

    expect(useCanvasStore.getState().highlightedEntity).toBe('endpoints');
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
    card.remove();
  });
});
