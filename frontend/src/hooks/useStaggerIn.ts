import { useEffect, useRef, type DependencyList } from 'react';
import { staggerIn } from '../lib/motion';

/**
 * Animates every `[data-animate]` descendant of the returned ref into view,
 * re-running when `deps` change (for example when data arrives).
 */
export function useStaggerIn<T extends HTMLElement = HTMLDivElement>(deps: DependencyList, opts?: { y?: number; stagger?: number }) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!ref.current) return;
    staggerIn(ref.current.querySelectorAll('[data-animate]'), opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
