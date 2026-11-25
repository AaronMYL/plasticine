import { useSyncExternalStore } from 'react';

interface NavState {
  plasticineNav?: number;
  plasticinePrevious?: string;
  plasticineRoute?: string;
}

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

export function useNavHistory(): { canBack: boolean; canForward: boolean } {
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { canBack: value[0] === '1', canForward: value[1] === '1' };
}

