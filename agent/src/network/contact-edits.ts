// 第 12 批（11-12 Aaron 定）：人和人的聊天里加表情、回某一句；联系人改备注、删除。
// - 表情：一对一里认那封信的信封 id，群里认那一句的 messageId；发一封 reaction（不算未读、不顶到列表最上面）。
//   一句话上的表情 = 每个人（我 / 每个联系人）每种表情最后一次是加还是拿掉。
// - 回某一句：一对一 text 的 replyTo、群里 group_message 的 replyTo，都是那一句的同一个 id。
// - 删除联系人：只记 removed_at，列表里没有了，关系回到陌生人（对方的 Plasticine 不能再按朋友档问）；不通知对方。
//   对方再来信，inbound 把他变成一条加好友请求。聊天记录留着，「最近删除」里能恢复。

import type { NET_REACTIONS } from '../../shared/net-wire.ts';

type NetReaction = (typeof NET_REACTIONS)[number];
import type { Contact, ContactMessage, GroupMessage } from '../../shared/state.ts';
import type { Changes } from '../attention/index.ts';
import { changeOf, groupChange, requireContact, requireIdentity, type NetworkContext } from './context.ts';
import { NetworkError } from './errors.ts';
import { fanOut, requireGroup } from './groups.ts';
import { enqueue } from './outbox.ts';

const REACTABLE = new Set(['text', 'ai_text', 'ask_ai', 'hello']);

/** 一句话在两端共用的 id：一对一是信封 id，群里是 messageId。 */
export function contactMessageKey(message: ContactMessage): string | null {
  return REACTABLE.has(message.kind) ? message.envelopeId ?? null : null;
}

export interface ReactionView {
  emoji: string;
  mine: boolean;
  count: number;
}

/** 把一串 reaction 信折成每句话上的表情。rows 按时间先后。 */
export function foldReactions(rows: readonly ContactMessage[]): Map<string, ReactionView[]> {
  const latest = new Map<string, Map<string, boolean>>();
  for (const row of rows) {
    const key = row.payload?.['messageId'];
    const emoji = row.payload?.['emoji'];
    if (typeof key !== 'string' || typeof emoji !== 'string') continue;
    const who = row.direction === 'out' ? 'me' : row.contactId;
    const forKey = latest.get(key) ?? new Map<string, boolean>();
    forKey.set(`${who}\u0000${emoji}`, row.payload?.['on'] === true);
    latest.set(key, forKey);
  }
  const out = new Map<string, ReactionView[]>();
  for (const [key, states] of latest) {
    const counts = new Map<string, ReactionView>();
    for (const [pair, on] of states) {
      if (!on) continue;
      const [who, emoji] = pair.split('\u0000') as [string, string];
      const view = counts.get(emoji) ?? { emoji, mine: false, count: 0 };
      counts.set(emoji, { emoji, mine: view.mine || who === 'me', count: view.count + 1 });
    }
    out.set(key, [...counts.values()]);
  }
  return out;
}

/** 一对一：给对方的一句话加 / 拿掉一个表情。 */
export function reactToContact(context: NetworkContext, contactId: string, messageId: string, emoji: NetReaction,
  on: boolean): ContactMessage {
  requireIdentity(context);
  const contact = requireContact(context, contactId);
  const target = context.state.contactMessages.get(messageId);
  const key = target === undefined || target.contactId !== contactId ? null : contactMessageKey(target);
  if (key === null) {
    throw new NetworkError('not_found', '没有这句话。');
  }
  usable(contact);
  return context.desk.commit((changes) => {
    const row = enqueue(context, contact, { kind: 'reaction', author: 'me', text: '', quiet: true,
      payload: { messageId: key, emoji, on } });
    after(context, changes, () => changeOf(contactId, [target?.id ?? messageId]));
    return row;
  });
}

/** 群里：给一句话加 / 拿掉一个表情（给每个成员各发一封；自己那几封就是自己的表情）。 */
export function reactInGroup(context: NetworkContext, groupId: string, message: GroupMessage, emoji: NetReaction,
  on: boolean): void {
  const group = requireGroup(context, groupId);
  if (message.groupId !== group.id || !['text', 'ask_ai', 'ai_text'].includes(message.kind)) {
    throw new NetworkError('not_found', '没有这句话。');
  }
  context.desk.commit((changes) => {
    fanOut(context, group, (contact) => {
      enqueue(context, contact, { kind: 'reaction', author: 'me', text: '', quiet: true, groupId: group.id,
        payload: { messageId: message.messageId, emoji, on, groupId: group.id } });
    });
    after(context, changes, () => groupChange(group.id, [message.id]));
  });
}

/** 改备注；null = 去掉备注，用他自己的名字。 */
export function setAlias(context: NetworkContext, contactId: string, version: number, alias: string | null): Contact {
  const trimmed = alias?.trim() ?? '';
  const contact = context.state.contacts.update(requireContact(context, contactId).id, version,
    { alias: trimmed === '' ? null : trimmed.slice(0, 40) });
  context.changed(changeOf(contactId, []));
  return contact;
}

/** 删除联系人：不通知对方；关系回陌生人、档位上限清掉；记录留着。 */
export function removeContact(context: NetworkContext, contactId: string): Contact {
  const contact = requireContact(context, contactId);
  if (contact.removedAt !== null) return contact;
  const removed = context.state.contacts.update(contact.id, contact.version,
    { removedAt: context.now().toISOString(), relation: 'stranger', tierCap: null });
  context.changed(changeOf(contactId, []));
  return removed;
}

/** 从「最近删除」里恢复：回到列表，关系仍是陌生人（要再按朋友档，就再改关系）。 */
export function restoreContact(context: NetworkContext, contactId: string): Contact {
  const contact = requireContact(context, contactId);
  if (contact.removedAt === null) return contact;
  const restored = context.state.contacts.update(contact.id, contact.version, { removedAt: null });
  context.changed(changeOf(contactId, []));
  return restored;
}

function usable(contact: Contact): void {
  if (contact.state === 'blocked') {
    throw new NetworkError('conflict', '已经拉黑了这个人。');
  }
  if (contact.safetyChanged) {
    throw new NetworkError('safety_changed', '对方的安全码变了。先在资料里核对安全码，再发。');
  }
}

function after(context: NetworkContext, changes: Changes, change: () => ReturnType<typeof changeOf>): void {
  changes.afterCommit(() => {
    context.kickOutbox();
    context.changed(change());
  });
}

/** 群里回的那一句的 messageId；不是这个群里的、或不给，就是 null。 */
export function groupReplyKey(context: Pick<NetworkContext, 'state'>, groupId: string,
  replyToId: string | undefined): string | null {
  if (replyToId === undefined) return null;
  const target = context.state.groupMessages.get(replyToId);
  return target === undefined || target.groupId !== groupId ? null : target.messageId;
}
