import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EASE_IN_OUT, MOTION, play } from './motion.ts';

export function Collapse({ open, className, id, children }: { open: boolean; className?: string; id?: string;
  children: ReactNode }): ReactNode {
  const element = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(open);
  const last = useRef(open);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const box = element.current;
    if (last.current === open || box === null) {
      return;
    }
    last.current = open;
    if (open) {
      setShown(true);
      return;
    }
    const height = box.getBoundingClientRect().height;
    const animation = play(box, [{ height: `${height}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
      MOTION.slow, EASE_IN_OUT);
    if (animation === null) {
      setShown(false);
      return;
    }
    box.style.overflow = 'hidden';
    animation.onfinish = () => {
      box.style.overflow = '';
      if (!last.current) setShown(false);
    };
  }, [open]);
  useLayoutEffect(() => {
    const box = element.current;
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!shown || box === null || !open) {
      return;
    }
    const height = box.getBoundingClientRect().height;
    if (height === 0) {
      return;
    }
    const animation = play(box, [{ height: '0px', opacity: 0 }, { height: `${height}px`, opacity: 1 }],
      MOTION.slow, EASE_IN_OUT);
    if (animation !== null) {
      box.style.overflow = 'hidden';
      animation.onfinish = () => {
        box.style.overflow = '';
      };
    }
  }, [shown]);
  return <div ref={element} id={id} className={className} hidden={!shown}>{children}</div>;
}
