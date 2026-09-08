/**
 * manifestSchema.ts – Zod validation for the hackathon seed manifest consumed
 * by seed-hackathon.ts. Pure module: no DB import, so it (and anything that
 * only imports it) is safe to unit-test without a database.
 *
 * Field-level rules mirror the conventions already used elsewhere in the
 * codebase — the FQDN regex and per-row shape match
 * onboarding.service.ts's onboardingRowSchema, and the fingerprint
 * normalization matches lib/certFingerprint.ts (SHA-512 login fingerprint).
 * On top of that, every domain is additionally required to end in
 * `.example.de` — this tool only ever seeds fictional hackathon data (see
 * seed-testdata.ts and the project's fictional-data policy in CLAUDE.md),
 * so a manifest naming a real organization is rejected outright rather than
 * silently seeded.
 *
 * Dependencies: zod, lib/certFingerprint (normalizeFingerprint /
 * isValidSha512Fingerprint), services/certificate.service (rejectPrivateKey).
 */
import { z } from 'zod';
import { normalizeFingerprint, isValidSha512Fingerprint } from '../../lib/certFingerprint';
import { rejectPrivateKey } from '../../services/certificate.service';

// Mirrors onboarding.service.ts's organizationIdentifier regex.
const FQDN_REGEX = /^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/i;

// Fictional-data-only guard: this seed must never be pointed at a real domain.
const EXAMPLE_SUFFIX = '.example.de';

function isValidSha256Hex(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}

/** True iff `pem` carries no private key and at least looks like a certificate. */
function isSafeCertPem(pem: string): boolean {
  try {
    rejectPrivateKey(pem);
  } catch {
    return false;
  }
  return pem.includes('-----BEGIN CERTIFICATE-----');
}

const exampleFqdn = z
  .string()
  .regex(FQDN_REGEX, 'Must be a valid FQDN')
  .transform((v) => v.toLowerCase())
  .refine(
    (v) => v.endsWith(EXAMPLE_SUFFIX),
    `Must end with "${EXAMPLE_SUFFIX}" (fictional hackathon data only)`,
  );

const exampleEmail = z
  .string()
  .email()
  .transform((v) => v.toLowerCase())
  .refine(
    (v) => v.split('@')[1]?.endsWith(EXAMPLE_SUFFIX) ?? false,
    `Email domain must end with "${EXAMPLE_SUFFIX}" (fictional hackathon data only)`,
  );

export const hackathonUserSchema = z.object({
  email: exampleEmail,
  name: z.string().trim().min(1).max(255),
  orgIdentifier: exampleFqdn,
  orgName: z.string().trim().min(1).max(255),
  city: z.string().trim().min(1).max(100),
  countryCode: z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'Must be exactly 2 letters')
    .transform((v) => v.toUpperCase()),
  fingerprintSha512: z
    .string()
    .transform(normalizeFingerprint)
    .refine(isValidSha512Fingerprint, 'invalid SHA-512 fingerprint'),
  thumbprintSha256: z
    .string()
    .transform(normalizeFingerprint)
    .refine(isValidSha256Hex, 'invalid SHA-256 thumbprint'),
  certPem: z
    .string()
    .min(1)
    .refine(
      isSafeCertPem,
      'certPem must be a certificate (not a private key) containing a BEGIN CERTIFICATE block',
    ),
  admin: z.boolean(),
});

export type HackathonUser = z.infer<typeof hackathonUserSchema>;

export const hackathonManifestSchema = z
  .object({
    parentOrganization: exampleFqdn,
    users: z.array(hackathonUserSchema).min(1, 'users must contain at least one entry'),
  })
  .superRefine((manifest, ctx) => {
    // Duplicate values inside one manifest would make the per-user delete-
    // then-insert idempotency step (seed-hackathon.ts) clobber a sibling
    // user's rows on the same run, so guard against that here.
    const emails = new Set<string>();
    const orgIdentifiers = new Set<string>();
    const fingerprints = new Set<string>();
    const thumbprints = new Set<string>();
    manifest.users.forEach((u, i) => {
      if (emails.has(u.email)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate email in manifest: ${u.email}`,
          path: ['users', i, 'email'],
        });
      }
      emails.add(u.email);

      if (orgIdentifiers.has(u.orgIdentifier)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate orgIdentifier in manifest: ${u.orgIdentifier}`,
          path: ['users', i, 'orgIdentifier'],
        });
      }
      orgIdentifiers.add(u.orgIdentifier);

      if (fingerprints.has(u.fingerprintSha512)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate fingerprintSha512 in manifest for ${u.email}`,
          path: ['users', i, 'fingerprintSha512'],
        });
      }
      fingerprints.add(u.fingerprintSha512);

      if (thumbprints.has(u.thumbprintSha256)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate thumbprintSha256 in manifest for ${u.email}`,
          path: ['users', i, 'thumbprintSha256'],
        });
      }
      thumbprints.add(u.thumbprintSha256);
    });
  });

export type HackathonManifest = z.infer<typeof hackathonManifestSchema>;
