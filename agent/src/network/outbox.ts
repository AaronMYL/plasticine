// 发件箱（规格第 5 节 contact_messages 的「状态」）：要发的每一封先记成一行 sending（同一个事务里和它带来的改动一起
// 提交），再由这里加密、签名、交给中继。中继收下记 sent；连不上、超时、限速按退避重试，次数用完记 failed；中继明说
// 不收（4xx）直接 failed。信封 id 在记下那一刻就定了：重试是同一封，中继按 id 去重，对方也只收一次。
// 任务类的信发出后再给中继记一条任务状态（交付记录用）；那一条记不上只写日志，不让信变成失败。

import type { Envelope, EnvelopeKind, NetTaskStatus, Plaintext } from '../../shared/net-wire.ts';
import type { MessageAuthor } from '../../shared/api/contacts.ts';
import type { Contact, ContactMessage } from '../../shared/state.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { changeOf, groupChange, requireIdentity, signerOf, touchContact, type NetworkContext } from './context.ts';
import { sealEnvelope } from './crypto.ts';
import { RelayCallError } from './relay-client.ts';

/** 5 秒起、每次翻倍、最长 10 分钟，8 次（合起来二十来分钟）：对方中继重启、网络抖一下都等得过去。 */
export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_RETRY_BASE_MS = 5_000;
export const OUTBOX_RETRY_MAX_MS = 10 * 60 * 1000;
/** 一轮最多发这么多封，剩下的下一轮接着发。 */
const OUTBOX_BATCH = 50;
const ERROR_TEXT_MAX = 300;

export interface Outgoing<K extends EnvelopeKind = EnvelopeKind> {
  kind: K;
  author: MessageAuthor;
  /** 聊天里显示的那一句。 */
  text: string;
  payload: Plaintext<K>;
  exchangeId?: string | null;
  taskId?: string | null;
  requestId?: string | null;
  /** 群的那几封（给每个成员各一封）：不进一对一的聊天，也不把一对一的那一行顶上去。 */
  groupId?: string | null;
  /** 不进聊天的那几类（资料、头像）：也不把这个人在列表里顶上去。 */
  quiet?: boolean;
}

/** 记一封要发的信（在调用方的事务里）；提交以后叫发件箱。 */
export function enqueue<K extends EnvelopeKind>(context: NetworkContext, contact: Contact, outgoing: Outgoing<K>):
  ContactMessage {
  const at = context.now().toISOString();
  const message = context.state.contactMessages.create({
    contactId: contact.id,
    direction: 'out',
    author: outgoing.author,
    kind: outgoing.kind,
    text: outgoing.text,
    payload: outgoing.payload as Record<string, unknown>,
    exchangeId: outgoing.exchangeId ?? null,
    taskId: outgoing.taskId ?? null,
    sentAt: at,
    status: 'sending',
    envelopeId: context.newId(),
    requestId: outgoing.requestId ?? null,
    groupId: outgoing.groupId ?? null,
  });
  if ((outgoing.groupId ?? null) === null && outgoing.quiet !== true) {
    touchContact(context, contact.id, at);
  }
  return message;
}

/** 任务类的信对应中继上的哪一种任务状态。 */
export function relayStatusOf(message: Pick<ContactMessage, 'kind' | 'payload'>): NetTaskStatus | null {
  const payload = message.payload ?? {};
  switch (message.kind) {
    case 'task_offer':
      return 'offered';
    case 'task_reply':
      return payload['decision'] === 'decline' ? 'declined' : 'accepted';
    case 'task_delivery':
      return 'delivered';
    case 'task_verdict':
      return payload['verdict'] === 'pass' ? 'passed' : 'rejected';
    default:
      return null;
  }
}

export function retryDelayMs(attempts: number): number {
  return Math.min(OUTBOX_RETRY_BASE_MS * 2 ** Math.max(attempts - 1, 0), OUTBOX_RETRY_MAX_MS);
}

function clipError(text: string): string {
  return Array.from(text).slice(0, ERROR_TEXT_MAX).join('');
}

export class Outbox {
  readonly #context: NetworkContext;
  #running: Promise<number> | null = null;

  constructor(context: NetworkContext) {
    this.#context = context;
  }

  /** 发一轮到了时候的；同时只有一轮在跑，再叫一次拿到的是同一轮。返回这一轮发出去几封。 */
  flush(signal?: AbortSignal): Promise<number> {
    this.#running ??= this.#flush(signal).finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  /** 下一封要重试的时间（发件箱空了是 undefined）。 */
  nextAttemptAt(): string | undefined {
    return this.#context.state.contactMessages.nextAttemptAt();
  }

  async #flush(signal: AbortSignal | undefined): Promise<number> {
    const { state, now } = this.#context;
    if (state.networkIdentity.get() === undefined) {
      return 0;
    }
    let sent = 0;
    for (const message of state.contactMessages.outboxDue(now().toISOString(), OUTBOX_BATCH)) {
      if (signal?.aborted === true) {
        break;
      }
      if (await this.#send(message)) {
        sent += 1;
      }
    }
    return sent;
  }

  async #send(message: ContactMessage): Promise<boolean> {
    const context = this.#context;
    const { state } = context;
    const identity = requireIdentity(context);
    const contact = state.contacts.require(message.contactId);
    if (contact.safetyChanged) {
      this.#settle(message, 'failed', '对方的安全码变了，核对之后再发。');
      return false;
    }
    if (message.kind === 'system') {
      // 本机自己记的说明从不外发；真走到这里是写错了方向，记成失败而不是改头换面发出去。
      this.#settle(message, 'failed', '这一条只记在本机，不发。');
      return false;
    }
    const envelope: Envelope = sealEnvelope({
      id: message.envelopeId ?? message.id,
      from: identity.accountId,
      to: contact.accountId,
      sentAt: message.sentAt,
      kind: message.kind,
      plaintext: message.payload ?? {},
      recipientEncryptionKey: contact.encryptionKey,
      senderSigningPrivateKey: identity.signingPrivateKey,
    });
    const signer = signerOf(identity);
    try {
      await context.relay().postEnvelope(signer, envelope);
    } catch (error) {
      this.#failed(message, error);
      return false;
    }
    // 群里接下的任务没有「发出」那一条（中继认两端靠它），交付记录只记一对一的。
    const status = message.groupId === null ? relayStatusOf(message) : null;
    if (status !== null && message.taskId !== null) {
      try {
        await context.relay().taskStatus(signer, message.taskId, status, contact.accountId);
      } catch (error) {
        // 信已经到了中继；状态记录只是交付记录的旁证，记不上下次也不补（两端本地各有一份）。
        safeLog('warn', 'network_task_status_failed', { objectId: message.taskId, category: errorCategory(error) });
      }
    }
    this.#settle(message, 'sent', null);
    return true;
  }

  #failed(message: ContactMessage, error: unknown): void {
    if (error instanceof RelayCallError && error.kind === 'refused' && error.status !== 429) {
      this.#settle(message, 'failed', clipError(error.message));
      return;
    }
    const attempts = message.attempts + 1;
    if (attempts >= OUTBOX_MAX_ATTEMPTS) {
      this.#settle(message, 'failed', '中继一直连不上，这封没发出去。', attempts);
      return;
    }
    if (!(error instanceof RelayCallError)) {
      safeLog('error', 'network_send_failed', { objectId: message.id, category: errorCategory(error) });
    }
    const next = new Date(this.#context.now().getTime() + retryDelayMs(attempts)).toISOString();
    const current = this.#context.state.contactMessages.require(message.id);
    this.#context.state.contactMessages.update(current.id, current.version, { attempts, nextAttemptAt: next,
      error: error instanceof Error ? clipError(error.message) : null });
  }

  #settle(message: ContactMessage, status: 'sent' | 'failed', error: string | null, attempts?: number): void {
    const { state } = this.#context;
    const current = state.contactMessages.require(message.id);
    state.contactMessages.update(current.id, current.version, { status, error, nextAttemptAt: null,
      ...(attempts === undefined ? {} : { attempts }) });
    const tasks = message.taskId === null ? [] : [message.taskId];
    this.#context.changed(message.groupId === null ? changeOf(message.contactId, [message.id], tasks)
      : groupChange(message.groupId, [], tasks));
  }
}
