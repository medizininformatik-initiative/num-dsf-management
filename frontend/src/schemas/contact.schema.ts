/**
 * contact.schema.ts — Zod schema for contact form input (types, name, email, phone, address).
 * Requires at least one contact type and a valid email; optional fields validated when present.
 */
import { z } from 'zod';

const CONTACT_TYPES = ['MEDIC', 'DSF_ADMIN', 'SECURITY'] as const;

export const contactSchema = z.object({
  types: z.array(z.enum(CONTACT_TYPES)).min(1, 'contactTypesRequired'),
  name: z.string().optional(),
  email: z.string().email('emailInvalid').max(255, 'emailTooLong'),
  phone: z
    .string()
    .max(50, 'contactPhoneInvalid')
    // optional leading +, digits, regular spaces and - ( ) / . ; at least 6 digits (extensions allowed)
    .regex(/^(?=(?:\D*\d){6})\+?[\d \-()/.]+$/, 'contactPhoneInvalid')
    .or(z.literal(''))
    .nullish(),
  addressLine: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  countryCode: z
    .string()
    .length(2, 'countryCodeInvalid')
    .toUpperCase()
    .optional()
    .or(z.literal('')),
});

export type ContactFormData = z.infer<typeof contactSchema>;
