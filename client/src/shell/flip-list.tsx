import { useRef, type ReactNode } from 'react';
import { useFlipList } from './motion.ts';

export function FlipList({ className, keys, label, children }: { className: string; keys: readonly string[];
  label?: string; children: ReactNode; }): ReactNode {
  const list = useRef<HTMLUListElement>(null);
  useFlipList(list, keys);
  return <ul ref={list} className={className} aria-label={label}>{children}</ul>;
}
