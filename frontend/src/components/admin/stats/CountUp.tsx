/**
 * CountUp.tsx – a number that counts up from 0 on mount.
 * Dependencies: lib/useCountUp
 */
import { useCountUp } from '../../../lib/useCountUp';

export function CountUp({ value }: { value: number }) {
  const shown = useCountUp(value);
  return <span className="tabular-nums">{shown}</span>;
}
