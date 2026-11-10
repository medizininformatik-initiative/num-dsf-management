/**
 * useNow.ts – the current time in milliseconds, re-rendering the caller every
 * `intervalMs` (default one minute) so countdowns stay current.
 * Dependencies: react.
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
