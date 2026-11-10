/**
 * processHandlers.ts – Process-level safety net: log an unhandled promise
 * rejection instead of letting Node end the server. Express 4 does not catch
 * rejections of async handlers; the guards forward theirs to next(err), this
 * covers anything that still slips through (the request then times out, the
 * other requests keep being served). Idempotent; installed by app.ts.
 * Dependencies: lib/logger
 */
import { logger } from './logger';

let installed = false;

export function installProcessHandlers(): void {
  if (installed) return;
  installed = true;
  process.on('unhandledRejection', (reason: unknown) => {
    // Only the error itself; never request bodies (they may carry a PEM).
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
}
