import { useEffect, useRef, useState } from 'react';

/**
 * Animates a number from 0 to `end` over `duration` ms using easeOutExpo.
 */
export function useCountUp(end: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const prev = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    const start = prev.current;
    const diff = end - start;
    if (diff === 0) return;

    const t0 = performance.now();

    function tick(now: number) {
      const elapsed = now - t0;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutExpo
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = Math.round(start + diff * eased);
      setValue(current);

      if (progress < 1) {
        raf.current = requestAnimationFrame(tick);
      } else {
        prev.current = end;
      }
    }

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [end, duration]);

  return value;
}
