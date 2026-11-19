/**
 * CountUp.tsx – a number that counts up from 0 on mount. The animated digits
 * are hidden from assistive technology; the real value follows as screen
 * reader text so no intermediate number is ever announced.
 * Dependencies: lib/useCountUp
 */
import { useCountUp } from '../../../lib/useCountUp';

export function CountUp({ value }: { value: number }) {
  const shown = useCountUp(value);
  return (
    <>
      <span aria-hidden="true" className="tabular-nums">
        {shown}
      </span>
      <span className="sr-only">{value}</span>
    </>
  );
}
