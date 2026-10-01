import { useRef, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { pageSwap, staggerIn } from '../lib/motion';

const ENTER_SELECTOR = '.card, [data-animate]';

/**
 * Wraps page content. On every route change the old page fades out and the
 * new one fades in. Independently of routes, a MutationObserver watches the
 * page: any card or `[data-animate]` element that appears (after a fetch,
 * a filter, an expanded row) lifts into place once, in a short stagger.
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
    });
  }, [location.pathname]);

  // Same route, new content (data arrived, state changed): render it directly.
  useEffect(() => {
    if (location.pathname === prevPath.current && !swapping.current) {
      setDisplayChildren(children);
    }
  }, [children, location.pathname]);

  // Appearance animation for anything that mounts inside the page.
  useEffect(() => {
    const root = el.current;
    if (!root) return;
    const seen = new WeakSet<Element>();
    let queue: Element[] = [];
    let raf = 0;
    const flush = () => {
      raf = 0;
      const batch = queue.filter((n) => n.isConnected);
      queue = [];
      if (batch.length) staggerIn(batch, { y: 8, stagger: 0.035 });
    };
    const collect = (node: Node) => {
      if (!(node instanceof Element)) return;
      const found: Element[] = node.matches(ENTER_SELECTOR) ? [node] : [];
      found.push(...Array.from(node.querySelectorAll(ENTER_SELECTOR)));
      for (const n of found) {
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
      if (queue.length && !raf) raf = requestAnimationFrame(flush);
    };
    collect(root);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) m.addedNodes.forEach(collect);
    });
    mo.observe(root, { childList: true, subtree: true });
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);

  return <div ref={el}>{displayChildren}</div>;
}
