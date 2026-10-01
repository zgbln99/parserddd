/**
 * Motion helpers (GSAP). Every call respects `prefers-reduced-motion`, so a
 * viewer who asked for less motion sees the final state immediately.
 */
import { gsap } from 'gsap';

const EASE = 'power3.out';

export function reducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fade + lift a group of elements in, one after another. */
export function staggerIn(targets: Element[] | NodeListOf<Element> | Element | null, opts: { delay?: number; y?: number; stagger?: number } = {}) {
  if (!targets) return;
  const list = targets instanceof Element ? [targets] : Array.from(targets);
  if (list.length === 0) return;
  if (reducedMotion()) {
    gsap.set(list, { opacity: 1, y: 0, clearProps: 'transform' });
    return;
  }
  gsap.killTweensOf(list);
  gsap.fromTo(
    list,
    { opacity: 0, y: opts.y ?? 10 },
    { opacity: 1, y: 0, duration: 0.42, ease: EASE, stagger: opts.stagger ?? 0.045, delay: opts.delay ?? 0, overwrite: true, clearProps: 'transform' },
  );
}

/** Popover / menu opening: a short scale-up from its anchor edge. */
export function popIn(el: Element | null, origin = 'top left') {
  if (!el) return;
  if (reducedMotion()) { gsap.set(el, { opacity: 1, scale: 1 }); return; }
  gsap.fromTo(el, { opacity: 0, scale: 0.96, y: -4, transformOrigin: origin },
    { opacity: 1, scale: 1, y: 0, duration: 0.18, ease: 'power2.out', clearProps: 'transform' });
}

/** Page leave + enter used by PageTransition. Returns the GSAP timeline. */
export function pageSwap(el: Element, onSwap: () => void) {
  if (reducedMotion()) { onSwap(); gsap.set(el, { opacity: 1 }); return null; }
  const tl = gsap.timeline();
  tl.to(el, { opacity: 0, y: -4, duration: 0.12, ease: 'power1.in' })
    .add(onSwap)
    .fromTo(el, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.26, ease: EASE, clearProps: 'transform' });
  return tl;
}

/** A number that "ticks" from its previous value to the new one. */
export function tickNumber(el: Element | null, from: number, to: number, format: (n: number) => string) {
  if (!el) return;
  if (reducedMotion() || from === to) { el.textContent = format(to); return; }
  const obj = { v: from };
  gsap.to(obj, { v: to, duration: 0.7, ease: 'power2.out', onUpdate: () => { el.textContent = format(obj.v); } });
}
