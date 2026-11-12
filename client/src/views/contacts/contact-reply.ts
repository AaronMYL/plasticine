// 第 12 批：联系人和群里「引用这条」= 回这个聊天里的某一句（对方看得到回的是哪句）。按聊天记一句，输入框上方出一片
// 「回复 小林：……」，发出去时带上那一句的 id，发成了就收起；点 × 或换一句就换掉。只在这一页里记，不跨刷新。

import { useSyncExternalStore } from 'react';

export interface ContactReply {
  id: string;
  author: string;
  text: string;
}

const replies = new Map<string, ContactReply>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setContactReply(threadId: string, reply: ContactReply | null): void {
  if (reply === null) {
    if (!replies.delete(threadId)) return;
  } else {
    replies.set(threadId, reply);
  }
  emit();
}

export function contactReplyOf(threadId: string): ContactReply | null {
  return replies.get(threadId) ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useContactReply(threadId: string): ContactReply | null {
  return useSyncExternalStore(subscribe, () => contactReplyOf(threadId), () => null);
}
