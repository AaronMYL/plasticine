// 用户对联系人做的事（规格第 6 节）：按 @handle 加人（发 hello）、处理请求（接受 / 拉黑 / 先不理）、改关系或单独的
// 档位上限、标已读、核对安全码之后换上新钥匙、发一句话（给人，或问对方的 Plasticine）。要发的信都先进发件箱。

import type { ContactRelation } from '../../shared/api/contacts.ts';
import type { Tier } from '../../shared/api/visibility.ts';
import type { Contact, ContactMessage, NetworkIdentity } from '../../shared/state.ts';
import { changeOf, requireContact, requireIdentity, signerOf, type NetworkContext } from './context.ts';
import { NetworkError } from './errors.ts';
import { enqueue } from './outbox.ts';
import { RelayCallError } from './relay-client.ts';

function relayError(error: unknown, notFound: string): never {
  if (error instanceof RelayCallError) {
    if (error.kind === 'refused' && error.status === 404) {
      throw new NetworkError('not_found', notFound);
    }
    throw error.kind === 'refused' ? new NetworkError('relay_refused', error.message)
      : new NetworkError('relay_unreachable', '连不上 Cyber Hunter 中继，这次没做成。稍后再试。');
  }
  throw error;
}

function hello(context: NetworkContext, identity: NetworkIdentity, contact: Contact, note: string | null,
  requestId: string | null): ContactMessage {
  return enqueue(context, contact, { kind: 'hello', author: 'me', text: note ?? `加了 @${contact.handle}`,
    payload: { displayName: identity.displayName, note, avatar: identity.avatar }, requestId });
}

const HANDLE = /^[a-z0-9_]{3,24}$/;

/**
 * 加好友时填的那一串拆出 handle：@xiaolin、xiaolin、xiaolin.cyberhunter.top、https://xiaolin.cyberhunter.top/add
 * 都是 xiaolin。认不出是 null。
 */
export function normalizeHandle(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (/^https?:\/\//.test(value)) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  }
  value = value.replace(/^@/, '').split('/')[0] ?? '';
  const handle = value.includes('.') ? value.split('.')[0] ?? '' : value;
  return HANDLE.test(handle) ? handle : null;
}

export interface AddContactInput {
  handle: string;
  note: string | null;
  requestId: string;
}

/** 按 @handle 加人：查中继拿到对方两把公钥（TOFU 记下），发一封 hello。对方已经来过请求的，加就是接受。 */
export async function addContact(context: NetworkContext, input: AddContactInput): Promise<Contact> {
  const identity = requireIdentity(context);
  const earlier = context.state.contactMessages.byRequest(input.requestId);
  if (earlier !== undefined) {
    return requireContact(context, earlier.contactId);
  }
  const handle = normalizeHandle(input.handle);
  if (handle === null) {
    throw new NetworkError('invalid_input', '认不出这个账号：填 @handle，或者朋友发来的链接。', 'handle');
  }
  if (handle === identity.handle) {
    throw new NetworkError('invalid_input', '不能加自己。', 'handle');
  }
  const signer = signerOf(identity);
  const account = await context.relay().account(signer, handle).catch((error: unknown) =>
    relayError(error, '网络上没有这个 @handle。'));
  const existing = context.state.contacts.byAccount(account.id);
  if (existing?.state === 'blocked') {
    await context.relay().unblock(signer, account.id).catch((error: unknown) => relayError(error, '没有这个账号。'));
  }
  const contact = context.desk.commit((changes) => {
    const now = context.now().toISOString();
    let row = context.state.contacts.byAccount(account.id);
    if (row === undefined) {
      row = context.state.contacts.create({ accountId: account.id, handle: account.handle,
        displayName: account.displayName, signingKey: account.signingKey, encryptionKey: account.encryptionKey,
        state: 'pending', lastAt: now });
    } else if (row.state === 'active' || row.state === 'pending') {
      return row;
    } else {
      // request：对方先加过我，加他就是接受；blocked / member（只在群里见过）：发一个新的请求。
      row = context.state.contacts.update(row.id, row.version, {
        state: row.state === 'request' ? 'active' : 'pending', ignoredAt: null });
    }
    const message = hello(context, identity, row, input.note, input.requestId);
    changes.afterCommit(() => {
      context.kickOutbox();
      context.changed(changeOf(message.contactId, [message.id]));
    });
    return context.state.contacts.require(row.id);
  });
  return contact;
}

export type RequestDecision = 'accept' | 'block' | 'ignore';

/** 处理一条联系人请求。拉黑先告诉中继（之后他发来的信中继直接丢），再记在本机。 */
export async function decideRequest(context: NetworkContext, contactId: string, decision: RequestDecision):
  Promise<Contact> {
  const identity = requireIdentity(context);
  const contact = requireContact(context, contactId);
  if (decision === 'block') {
    await context.relay().block(signerOf(identity), contact.accountId).catch((error: unknown) =>
      relayError(error, '网络上没有这个账号。'));
  }
  return context.desk.commit((changes) => {
    const current = requireContact(context, contactId);
    let updated: Contact;
    if (decision === 'block') {
      updated = context.state.contacts.update(current.id, current.version, { state: 'blocked' });
    } else if (decision === 'ignore') {
      updated = context.state.contacts.update(current.id, current.version,
        { ignoredAt: context.now().toISOString() });
    } else {
      if (current.state !== 'request') {
        return current;
      }
      updated = context.state.contacts.update(current.id, current.version, { state: 'active', ignoredAt: null });
      hello(context, identity, updated, null, null);
    }
    changes.afterCommit(() => {
      context.kickOutbox();
      context.changed(changeOf(contactId));
    });
    return context.state.contacts.require(updated.id);
  });
}

export interface RelationChange {
  version: number;
  relation?: ContactRelation;
  /** 不给 = 不改；null = 清掉单独的上限，按关系。 */
  tierCap?: Tier | null;
}

export function setRelation(context: NetworkContext, contactId: string, change: RelationChange): Contact {
  requireContact(context, contactId);
  const updated = context.state.contacts.update(contactId, change.version, {
    ...(change.relation === undefined ? {} : { relation: change.relation }),
    ...(change.tierCap === undefined ? {} : { tierCap: change.tierCap }),
  });
  context.changed(changeOf(contactId));
  return updated;
}

export function markRead(context: NetworkContext, contactId: string, upTo: string): number {
  requireContact(context, contactId);
  const marked = context.state.contactMessages.markRead(contactId, upTo, context.now().toISOString());
  if (marked > 0) {
    context.changed(changeOf(contactId));
  }
  return marked;
}

/** 用户核对过安全码：换上中继给的新钥匙，之后照常收发。 */
export function confirmSafety(context: NetworkContext, contactId: string, version: number): Contact {
  const contact = requireContact(context, contactId);
  if (!contact.safetyChanged || contact.pendingSigningKey === null || contact.pendingEncryptionKey === null) {
    return contact;
  }
  const updated = context.state.contacts.update(contact.id, version, { signingKey: contact.pendingSigningKey,
    encryptionKey: contact.pendingEncryptionKey, pendingSigningKey: null, pendingEncryptionKey: null,
    safetyChanged: false });
  context.changed(changeOf(contactId));
  return updated;
}

export interface SendInput {
  text: string;
  /** person = 给人；ai = 问对方的 Plasticine；mine = @ 自己的 Plasticine（它接着照对面能听到的档位答）。 */
  target: 'person' | 'ai' | 'mine';
  requestId: string;
}

/** 发一句（进发件箱）。给还在请求里的人回话就是接受了他。 */
export function sendMessage(context: NetworkContext, contactId: string, input: SendInput): ContactMessage {
  const earlier = context.state.contactMessages.byRequest(input.requestId);
  if (earlier !== undefined) {
    if (earlier.contactId !== contactId || earlier.text !== input.text) {
      throw new NetworkError('conflict', '这个 requestId 已经用在另一句话上了，这次没有发。', 'requestId');
    }
    return earlier;
  }
  requireIdentity(context);
  const contact = requireContact(context, contactId);
  if (contact.state === 'blocked') {
    throw new NetworkError('conflict', '已经拉黑了这个人；要说话，先按 @handle 重新加他（会取消拉黑）。');
  }
  if (contact.safetyChanged) {
    throw new NetworkError('safety_changed', '对方的安全码变了。先在资料里核对安全码，再发。');
  }
  return context.desk.commit((changes) => {
    const current = requireContact(context, contactId);
    const ready = current.state === 'request'
      ? context.state.contacts.update(current.id, current.version, { state: 'active', ignoredAt: null })
      : current;
    // 问对方的 Plasticine 开一段新的 AI 沟通：对方的回答带着同一个 exchangeId 回来。
    const exchangeId = context.newId();
    const message = input.target === 'ai'
      ? enqueue(context, ready, { kind: 'ask_ai', author: 'me', text: input.text, requestId: input.requestId,
        exchangeId, payload: { text: input.text, exchangeId, fromAi: false } })
      : enqueue(context, ready, { kind: 'text', author: 'me', text: input.text, requestId: input.requestId,
        ...(input.target === 'mine' ? { exchangeId } : {}),
        payload: { text: input.text, replyTo: null, ...(input.target === 'mine' ? { toOwnAi: true } : {}) } });
    changes.afterCommit(() => {
      context.kickOutbox();
      context.changed(changeOf(contactId, [message.id]));
    });
    return message;
  });
}
