/**
 * mailRecipients.ts – Never hand an undeliverable recipient to the SMTP relay.
 * Addresses in a reserved `.invalid` domain (RFC 2606) are placeholders that
 * can never receive mail; sending to them only produces bounces. The guard
 * wraps a transport's sendMail: such recipients are dropped, and a message
 * without any remaining recipient is not sent at all.
 * Dependencies: none
 */

/** True for an address whose domain is in the reserved `.invalid` TLD. */
export function isUndeliverableAddress(address: string): boolean {
  const m = /<([^>]*)>\s*$/.exec(address);
  const bare = (m ? m[1] : address).trim().toLowerCase();
  const at = bare.lastIndexOf('@');
  return (
    at !== -1 &&
    bare
      .slice(at + 1)
      .replace(/\.$/, '')
      .endsWith('.invalid')
  );
}

function splitList(to: string): string[] {
  return to
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a !== '');
}

/** The deliverable part of a `to` value; null when nothing deliverable remains. */
export function deliverableRecipients(to: unknown): string | string[] | null {
  if (typeof to === 'string') {
    const kept = splitList(to).filter((a) => !isUndeliverableAddress(a));
    return kept.length > 0 ? kept.join(',') : null;
  }
  if (Array.isArray(to)) {
    const kept = to.filter((a): a is string => typeof a === 'string' && !isUndeliverableAddress(a));
    return kept.length > 0 ? kept : null;
  }
  return null;
}

interface Sendable<M extends { to?: unknown }> {
  sendMail(message: M): Promise<unknown>;
}

/** Wraps `transport.sendMail` in place and returns the same transport. */
export function skipUndeliverableRecipients<M extends { to?: unknown }, T extends Sendable<M>>(
  transport: T,
): T {
  const original = transport.sendMail.bind(transport) as (message: M) => Promise<unknown>;
  transport.sendMail = (async (message: M) => {
    const to = deliverableRecipients(message.to);
    if (to === null) return null;
    return original({ ...message, to });
  }) as T['sendMail'];
  return transport;
}
