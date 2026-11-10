/**
 * incident-hash-chain.test.ts – The incident timeline hash chain: canonical
 * JSON ignores key order, a correct chain verifies, and any change to content,
 * order or links is reported at the first broken event. A chain must start
 * with the REPORTED event; the field hashes it and later UPDATED events
 * record must match the stored incident.
 * Pure test: no database.
 * Dependencies: lib/incidentHashChain
 */
import {
  GENESIS_HASH,
  canonicalJson,
  eventHash,
  fieldHash,
  verifyChain,
  verifyFields,
  type ChainedEvent,
} from '../lib/incidentHashChain';

function chain(n: number): ChainedEvent[] {
  const events: ChainedEvent[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const content = {
      incidentId: 'inc-1',
      seq,
      at: new Date(Date.UTC(2026, 10, 10, 12, 0, seq, 123)),
      actorEmail: 'admin@imi-test.example.de',
      type: seq === 1 ? 'REPORTED' : 'COMMENT',
      details: { text: `event ${seq}`, nested: { b: 2, a: 1 } },
    };
    const hash = eventHash(prev, content);
    events.push({ ...content, prevHash: prev, hash });
    prev = hash;
  }
  return events;
}

describe('canonicalJson', () => {
  it('sorts keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[{"x":2,"y":1}]},"b":1}',
    );
  });

  it('drops undefined values like JSON.stringify', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('verifyChain', () => {
  it('accepts an intact chain', () => {
    expect(verifyChain(chain(4))).toEqual({ valid: true, brokenAt: null });
  });

  it('refuses an empty chain', () => {
    expect(verifyChain([])).toEqual({ valid: false, brokenAt: 1 });
  });

  it('refuses a chain that does not start with the report', () => {
    const events = chain(2);
    const first = { ...events[0], type: 'COMMENT' };
    first.hash = eventHash(GENESIS_HASH, first);
    expect(verifyChain([first])).toEqual({ valid: false, brokenAt: 1 });
  });

  it('does not depend on the key order of details', () => {
    const events = chain(2);
    events[1] = { ...events[1], details: { nested: { a: 1, b: 2 }, text: 'event 2' } };
    expect(verifyChain(events).valid).toBe(true);
  });

  it('reports changed content at that event', () => {
    const events = chain(3);
    events[1] = { ...events[1], details: { text: 'edited' } };
    expect(verifyChain(events)).toEqual({ valid: false, brokenAt: 2 });
  });

  it('reports a removed event', () => {
    const events = chain(3);
    events.splice(1, 1);
    expect(verifyChain(events)).toEqual({ valid: false, brokenAt: 3 });
  });

  it('reports a recomputed hash whose successor still links the old one', () => {
    const events = chain(3);
    const forged = { ...events[1], actorEmail: 'someone@example.de' };
    forged.hash = eventHash(forged.prevHash, forged);
    events[1] = forged;
    expect(verifyChain(events)).toEqual({ valid: false, brokenAt: 3 });
  });
});

describe('verifyFields', () => {
  const at = new Date(Date.UTC(2026, 10, 10, 12, 0, 0));
  const reported = (fields: Record<string, unknown>) => ({
    type: 'REPORTED',
    details: {
      fieldSha256: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fieldHash(v)])),
    },
  });

  it('accepts fields matching the latest recorded hashes', () => {
    const later = new Date(at.getTime() - 3_600_000).toISOString();
    const events = [
      reported({
        title: 't',
        description: 'd',
        organizationId: null,
        detectedAt: at.toISOString(),
      }),
      {
        type: 'UPDATED',
        details: { field: 'detectedAt', fieldSha256: { detectedAt: fieldHash(later) } },
      },
    ];
    expect(
      verifyFields(events, {
        title: 't',
        description: 'd',
        organizationId: null,
        detectedAt: later,
      }),
    ).toEqual([]);
  });

  it('names fields changed outside the timeline', () => {
    const events = [
      reported({
        title: 't',
        description: 'd',
        organizationId: 'a.example.de',
        detectedAt: at.toISOString(),
      }),
    ];
    expect(
      verifyFields(events, {
        title: 't',
        description: 'edited',
        organizationId: 'b.example.de',
        detectedAt: at.toISOString(),
      }),
    ).toEqual(['description', 'organizationId']);
  });
});
