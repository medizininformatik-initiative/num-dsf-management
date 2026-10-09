/**
 * membership.schema.ts – Zod validation for membership input
 */
import { z } from 'zod';
import { PARENT_IDENTIFIER_PATTERN } from '../lib/parentIdentifier';

const parentOrganization = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(255)
  .regex(PARENT_IDENTIFIER_PATTERN);

const membershipRoles = z.enum(['DIC', 'HRP', 'DMS', 'AMS']);

export const createMembershipSchema = z.object({
  parentOrganization,
  endpointId: z.string().min(1).max(255),
  roles: z.array(membershipRoles).min(1),
});

export const updateMembershipSchema = z.object({
  parentOrganization: parentOrganization.optional(),
  endpointId: z.string().min(1).max(255).optional(),
  roles: z.array(membershipRoles).min(1).optional(),
});
