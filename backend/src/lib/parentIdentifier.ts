/**
 * parentIdentifier.ts — shared pattern for a parent organization identifier (lower-case FQDN).
 * Dependencies: none.
 */
export const PARENT_IDENTIFIER_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
