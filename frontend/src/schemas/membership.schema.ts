/**
 * membership.schema.ts — Zod schema for membership form input (parent org, endpoint, roles).
 * Requires a parent organization (lower-case FQDN-style identifier), an endpoint, and at least
 * one role (DIC/HRP/DMS/AMS).
 */
import { z } from 'zod';

const ROLES = ['DIC', 'HRP', 'DMS', 'AMS'] as const;

/** Same rule as the backend: dot-separated lower-case labels, at least two. */
export const PARENT_IDENTIFIER_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export const membershipSchema = z.object({
  parentOrganization: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'membershipParentRequired')
    .max(255, 'membershipParentInvalid')
    .regex(PARENT_IDENTIFIER_PATTERN, 'membershipParentInvalid'),
  endpointId: z.string().min(3, 'membershipEndpointRequired'),
  roles: z.array(z.enum(ROLES)).min(1, 'membershipRolesRequired'),
});

export type MembershipFormData = z.infer<typeof membershipSchema>;
