/**
 * loopback.ts – True when a socket peer address is the local host itself.
 * Used to keep component-level health details away from everyone but the
 * container's own healthcheck. Dependencies: none.
 */
export function isLoopbackAddress(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}
