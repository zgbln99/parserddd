import { useEffect, useRef } from 'react';
import { tickNumber } from '../lib/motion';

/**
 * Renders a number that counts from its previous value to the new one
 * (GSAP). `format` turns the in-between values into text, e.g. fmtKm.
 */
export function TickNumber({ value, format = (n) => String(Math.round(n)), className }: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const el = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  useEffect(() => {
    tickNumber(el.current, prev.current, value, format);
    prev.current = value;
  }, [value, format]);
  return <span ref={el} className={className}>{format(value)}</span>;
}
