// 首次使用流程走到哪了（11-08）：建完账号记一笔「在第一次的流程里」，连接模型那一页据此显示第 2 步，之后接着
// 第 3 步「在手机上也能用」，走完（或跳过）擦掉、落在主线。记在这个标签页的 sessionStorage：桌面客户端换地方、
// 刷新都还在；关了窗口再开就不算第一次了（照常进）。

import { useSyncExternalStore } from 'react';

const KEY = 'plasticine.firstRun';
const listeners = new Set<() => void>();
/** sessionStorage 用不了时只记在内存里（这一页内照样走完三步）。 */
let memory = false;

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch (cause) {
    console.warn('sessionStorage 用不了，首次流程走到哪只记在这一页', cause);
    return null;
  }
}

export function inFirstRun(): boolean {
  const store = storage();
  return store === null ? memory : store.getItem(KEY) === '1';
}

function notify(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

export function startFirstRun(): void {
  memory = true;
  storage()?.setItem(KEY, '1');
  notify();
}

export function finishFirstRun(): void {
  memory = false;
  storage()?.removeItem(KEY);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFirstRun(): boolean {
  return useSyncExternalStore(subscribe, inFirstRun, inFirstRun);
}
