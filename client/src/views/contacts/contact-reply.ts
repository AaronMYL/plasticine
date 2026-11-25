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
