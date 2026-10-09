/**
 * membership-schema.test.ts — pure Zod validation tests for membership input.
 * No DB. Locks the parent-organization identifier rule (lower-cased FQDN).
 */
import { createMembershipSchema, updateMembershipSchema } from '../schemas/membership.schema';

const base = { parentOrganization: 'hackathon-hub.example.de', endpointId: 'ep', roles: ['DIC'] };

function parses(parentOrganization: string): boolean {
  return createMembershipSchema.safeParse({ ...base, parentOrganization }).success;
}

describe('createMembershipSchema parentOrganization', () => {
  it('accepts known and custom FQDN identifiers', () => {
    for (const id of ['medizininformatik-initiative.de', 'hackathon-hub.example.de', 'a.b']) {
      expect(parses(id)).toBe(true);
    }
  });

  it('lower-cases and trims before validating', () => {
    const r = createMembershipSchema.safeParse({ ...base, parentOrganization: ' Hub.Example.DE ' });
    expect(r.success && r.data.parentOrganization).toBe('hub.example.de');
  });

  it('rejects values that are not an identifier', () => {
    for (const id of [
      '',
      'nodots',
      'has space.de',
      '-a.de',
      'a-.de',
      'a..de',
      'a_b.de',
      'a.de/x',
    ]) {
      expect(parses(id)).toBe(false);
    }
  });

  it('rejects an identifier longer than 255 characters', () => {
    expect(parses(`${'a'.repeat(250)}.example.de`)).toBe(false);
  });

  it('applies the same rule on update', () => {
    expect(updateMembershipSchema.safeParse({ parentOrganization: 'bad value' }).success).toBe(
      false,
    );
    expect(updateMembershipSchema.safeParse({ parentOrganization: 'ok.example.de' }).success).toBe(
      true,
    );
    expect(updateMembershipSchema.safeParse({}).success).toBe(true);
  });
});
