/**
 * contact.schema.ts – Zod validation for contact input
 */
import { z } from 'zod';

const contactTypes = z.enum(['MEDIC', 'DSF_ADMIN', 'SECURITY']);

export const createContactSchema = z.object({
  types: z.array(contactTypes).min(1),
  name: z.string().max(255).optional().default(''),
  email: z.string().email().max(255),
  phone: z
    .string()
    .max(50)
    // optional leading +, digits, regular spaces (no tab/newline) and - ( ) / . ;
    // at least 6 digits (extensions allowed)
    .regex(/^(?=(?:\D*\d){6})\+?[\d \-()/.]+$/, 'Invalid phone format')
    .or(z.literal(''))
    .nullish()
    .transform((v) => v ?? ''),
  addressLine: z.string().max(255).optional().default(''),
  city: z.string().max(100).optional().default(''),
  postalCode: z.string().max(20).optional().default(''),
  countryCode: z.string().length(2).optional().or(z.literal('')),
});

export const updateContactSchema = createContactSchema;
