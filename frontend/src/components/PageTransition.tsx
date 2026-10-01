import { useRef, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { pageSwap, staggerIn } from '../lib/motion';

/**
 * Wraps page content. On every route change the old page fades out, the new
 * page fades in and its cards lift into place one after another (GSAP).
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [displayChildren, setDisplayChildren] = useState(children);
  const prevPath = useRef(location.pathname);
  const pendingChildren = useRef(children);
  const el = useRef<HTMLDivElement>(null);
  const swapping = useRef(false);

  pendingChildren.current = children;

  useEffect(() => {
    if (location.pathname === prevPath.current || !el.current) return;
    swapping.current = true;
    const target = location.pathname;
    pageSwap(el.current, () => {
      prevPath.current = target;
      setDisplayChildren(pendingChildren.current);
      swapping.current = false;
      // Cards get a frame to mount before the stagger starts.
      requestAnimationFrame(() => staggerIn(el.current?.querySelectorAll('[data-animate], .card') ?? null, { y: 8, stagger: 0.035 }));
    });
  }, [location.pathname]);

  // Same route, new content (data arrived, state changed): render it directly.
  useEffect(() => {
    if (location.pathname === prevPath.current && !swapping.current) {
      setDisplayChildren(children);
    }
  }, [children, location.pathname]);

  return <div ref={el}>{displayChildren}</div>;
}
