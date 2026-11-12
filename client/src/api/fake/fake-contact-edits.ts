// 假联系人的第 12 批写操作：加表情、回某一句、改备注、绑人物页、删除和恢复。和真服务端（agent/src/app/contact-edits.ts）
// 一样：表情对方也看得到，删除不通知对方、进「最近删除」能恢复；人物页只在这台 Plasticine 里，不对外。

import type { ContactMessageView, ContactMemory } from '../shared.ts';

type Entry = { type: 'message'; message: ContactMessageView } | { type: 'task' };

export type FakeReaction = NonNullable<ContactMessageView['reactions']>[number];

/** 在一段聊天里找某一句。 */
export function messageIn(entries: readonly Entry[], id: string): ContactMessageView | undefined {
  for (const entry of entries) {
    if (entry.type === 'message' && entry.message.id === id) return entry.message;
  }
  return undefined;
}

/** 加 / 拿掉我的一个表情，返回这句的新样子（数为 0 的表情不留）。 */
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

/** 回的那一句：谁说的、开头几十个字。 */
export function replyLine(message: ContactMessageView | undefined, names: { me: string; them: string })
  : NonNullable<ContactMessageView['replyTo']> | null {
  if (message === undefined) return null;
  const chars = Array.from(message.text);
  const text = chars.length <= REPLY_CHARS ? message.text : `${chars.slice(0, REPLY_CHARS - 1).join('')}…`;
  const author = message.sender?.name ?? (message.author === 'me' ? names.me : names.them);
  return { author, text };
}

/** 资料栏「记忆」一节的假数据：可选的人物页，绑了的那页带几行。 */
export function fakeMemory(docId: string | null, suggestId: string | null, people: ContactMemory['people'],
  lines: ContactMemory['lines']): ContactMemory {
  const page = (id: string | null): ContactMemory['doc'] => {
    const found = people.find((person) => person.id === id);
    return found === undefined ? null : { id: found.id, title: found.title };
  };
  const doc = page(docId);
  return { doc, suggest: doc === null ? page(suggestId) : null, lines: doc === null ? [] : lines, people };
}
