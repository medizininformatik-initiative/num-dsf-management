/**
 * processHandlers.test.ts – An unhandled promise rejection (an async route
 * handler without a catch) must be logged, not end the server process: Node
 * terminates on one when no 'unhandledRejection' listener is registered.
 * Dependencies: lib/processHandlers, lib/logger
 */
import { installProcessHandlers } from '../lib/processHandlers';
import { logger } from '../lib/logger';

describe('installProcessHandlers', () => {
  afterEach(() => jest.restoreAllMocks());

  it('registers one unhandledRejection listener, however often it is called', () => {
    installProcessHandlers();
    const before = process.listenerCount('unhandledRejection');
    installProcessHandlers();
    expect(process.listenerCount('unhandledRejection')).toBe(before);
    expect(before).toBeGreaterThanOrEqual(1);
  });

  it('logs the rejection instead of throwing', () => {
    installProcessHandlers();
    const spy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    const listeners = process.listeners('unhandledRejection');
    const ours = listeners[listeners.length - 1] as (r: unknown, p: Promise<unknown>) => void;
    expect(() => ours(new Error('boom'), Promise.resolve())).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });
});
