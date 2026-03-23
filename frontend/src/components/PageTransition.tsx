import { useRef, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Wraps page content and plays a fade+slide-up animation on every route change.
 * Uses a key swap approach: old content fades out, new content fades in.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [displayChildren, setDisplayChildren] = useState(children);
  const [transitionStage, setTransitionStage] = useState<'enter' | 'exit'>('enter');
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    if (location.pathname !== prevPath.current) {
      // Route changed — start exit
      setTransitionStage('exit');
    }
  }, [location.pathname]);

  const handleAnimationEnd = () => {
    if (transitionStage === 'exit') {
      // Exit done — swap content, start enter
      prevPath.current = location.pathname;
      setDisplayChildren(children);
      setTransitionStage('enter');
    }
  };

  // Keep children in sync when content updates on the same route
  useEffect(() => {
    if (location.pathname === prevPath.current && transitionStage === 'enter') {
      setDisplayChildren(children);
    }
  }, [children, location.pathname, transitionStage]);

  return (
    <div
      className={transitionStage === 'enter' ? 'page-enter' : 'page-exit'}
      onAnimationEnd={handleAnimationEnd}
    >
      {displayChildren}
    </div>
  );
}
