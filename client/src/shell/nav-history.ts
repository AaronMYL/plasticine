// 前进后退（《优化清单》第 2 条：Plasticine 自己的页面是导航，靠前进、后退和 ⌘K 找）：走浏览器自己的历史，每一步在
// history.state 里记一个序号，就知道还能不能退、能不能进（浏览器不告诉网页这两件事）。
// 换地址只有两种：走到别处（push，多一步）和把当前这一步改写（replace，比如把旧地址规整成新地址，不多一步）。

import { useSyncExternalStore } from 'react';

interface NavState {
  plasticineNav?: number;
  plasticinePrevious?: string;
  plasticineRoute?: string;
}

/** 这次打开以来走到过的最远一步（前进键能不能按）。 */
let furthest = 0;
const listeners = new Set<() => void>();

function stateOf(): NavState {
  const state: unknown = window.history.state;
  return typeof state === 'object' && state !== null ? state as NavState : {};
}

function indexNow(): number {
  return stateOf().plasticineNav ?? 0;
}

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function announce(): void {
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  emit();
}

/** 走到别处：多一步历史。地址一样就不动。 */
export function pushHash(hash: string): void {
  if (window.location.hash === hash) {
    return;
  }
  const index = indexNow() + 1;
  furthest = index;
  window.history.pushState({ plasticineNav: index, plasticinePrevious: window.location.hash || '#/today',
    plasticineRoute: hash }, '', hash);
  announce();
}

/** 改写当前这一步（规整旧地址、关掉弹框回到原来那页）：不多一步。 */
export function replaceHash(hash: string): void {
  if (window.location.hash === hash) {
    return;
  }
  window.history.replaceState({ ...stateOf(), plasticineNav: indexNow(), plasticineRoute: hash }, '', hash);
  announce();
}

export function goBack(): void {
  if (indexNow() > 0) window.history.back();
}

export function goForward(): void {
  if (indexNow() < furthest) window.history.forward();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

function snapshot(): string {
  const index = indexNow();
  return `${index > 0 ? 1 : 0}${index < furthest ? 1 : 0}`;
}

/** 前进后退两个键能不能按。 */
export function useNavHistory(): { canBack: boolean; canForward: boolean } {
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { canBack: value[0] === '1', canForward: value[1] === '1' };
}

/** 测试用：回到刚打开的样子。 */
export function resetNavHistory(): void {
  furthest = 0;
}
