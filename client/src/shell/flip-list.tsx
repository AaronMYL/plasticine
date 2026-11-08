// 动效铺全站（2026-11-03 第 109 条第 3 批）：列表新来一条淡入升起、重排时从旧位置平移过去（useFlipList），
// 首页之外的列表也用。只是一个带动效的 <ul>；减少动态效果时不动（motion.ts 里管）。

import { useRef, type ReactNode } from 'react';
import { useFlipList } from './motion.ts';

export function FlipList({ className, keys, label, children }: { className: string; keys: readonly string[];
  label?: string; children: ReactNode; }): ReactNode {
  const list = useRef<HTMLUListElement>(null);
  useFlipList(list, keys);
  return <ul ref={list} className={className} aria-label={label}>{children}</ul>;
}
