import type { ContactMessageView, ContactMemory } from '../shared.ts';

type Entry = { type: 'message'; message: ContactMessageView } | { type: 'task' };

export type FakeReaction = NonNullable<ContactMessageView['reactions']>[number];

export function messageIn(entries: readonly Entry[], id: string): ContactMessageView | undefined {
  for (const entry of entries) {
    if (entry.type === 'message' && entry.message.id === id) return entry.message;
  }
  return undefined;
}

export function withReaction(message: ContactMessageView, emoji: string, on: boolean): ContactMessageView {
  const list: FakeReaction[] = (message.reactions ?? []).map((reaction) => ({ ...reaction }));
  const found = list.find((reaction) => reaction.emoji === emoji);
  if (on && found === undefined) {
    list.push({ emoji, mine: true, count: 1 });
  } else if (on && found !== undefined && !found.mine) {
    found.mine = true;
    found.count += 1;
  } else if (!on && found?.mine === true) {
    found.mine = false;
    found.count -= 1;
  }
  return { ...message, reactions: list.filter((reaction) => reaction.count > 0) };
}

const REPLY_CHARS = 40;

export function replyLine(message: ContactMessageView | undefined, names: { me: string; them: string })
  : NonNullable<ContactMessageView['replyTo']> | null {
  if (message === undefined) return null;
  const chars = Array.from(message.text);
  const text = chars.length <= REPLY_CHARS ? message.text : `${chars.slice(0, REPLY_CHARS - 1).join('')}…`;
  const author = message.sender?.name ?? (message.author === 'me' ? names.me : names.them);
  return { author, text };
}

export function fakeMemory(docId: string | null, suggestId: string | null, people: ContactMemory['people'],
  lines: ContactMemory['lines']): ContactMemory {
  const page = (id: string | null): ContactMemory['doc'] => {
    const found = people.find((person) => person.id === id);
    return found === undefined ? null : { id: found.id, title: found.title };
  };
  const doc = page(docId);
  return { doc, suggest: doc === null ? page(suggestId) : null, lines: doc === null ? [] : lines, people };
}
