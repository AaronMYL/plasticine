// 收到的信（规格第 2、4、7 节）：验签（公钥首次见到就记下，之后只认记下的那把）→ 解密 → 对明文的格式 → 入库并做它
// 带来的事（建联系人请求、任务卡、分身的问题）→ 提交以后才确认收到。验不过、解不开、格式不对的丢掉并在聊天里记一条。
// 中继给的公钥和记下的不一样：不自动换，标「安全码变了」等用户核对，用新钥匙签的信在核对前一律丢掉。
// 进来的人话、AI 话都记成来源（没有指挥权）。

import { Value } from 'typebox/value';
import { PLAINTEXT_SCHEMAS, type AnyPlaintext, type Envelope, type EnvelopeKind,
  type NetAccount } from '../../shared/net-wire.ts';
import type { MessageAuthor } from '../../shared/api/contacts.ts';
import type { Contact, ContactMessage, NetworkIdentity } from '../../shared/state.ts';
import type { Changes } from '../attention/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { changeOf, groupChange, signerOf, type NetworkChange, type NetworkContext } from './context.ts';
import { openEnvelope } from '../../protocol/crypto.ts';
import { receiveClaim, receiveGroupTask } from './group-tasks.ts';
import { receiveGroupMessage, receiveGroupUpdate, unknownMembers, type GroupReceipt } from './groups.ts';
import { RelayCallError } from '../../protocol/relay-client.ts';
import { receiveCancel, receiveDelivery, receiveOffer, receiveReply, receiveVerdict } from './tasks.ts';

export interface InboundOutcome {
  /** 处理完（入库或丢掉）、可以向中继确认的信封。 */
  ackIds: string[];
  /** 问我的 Plasticine 的问题（消息 id），提交以后交给 responder。 */
  questions: string[];
  /** 群里问我的 Plasticine 的（群消息 id）。 */
  groupQuestions: string[];
  changes: NetworkChange[];
}

interface Applied {
  contact: Contact;
  message: ContactMessage;
  /** 群里的那几类：改的是群，不是一对一的聊天。 */
  group: GroupReceipt | null;
}

// 群和资料那几类：发件人得是认识的人，不认识的不建「请求」。
const GROUP_KINDS: readonly EnvelopeKind[] = ['group_update', 'group_message', 'group_task', 'task_claim'];

const NOTES = {
  signature: '收到一封验签不过的信，已丢掉。',
  decrypt: '收到一封解不开的信，已丢掉。',
  format: '收到一封格式不对的信，已丢掉。',
  failed: '收到的一封信处理时出错，已丢掉。',
  safety: '对方的安全码变了：中继上他的钥匙和你记下的不一样。核对安全码之前，用新钥匙签的信都会丢掉。',
} as const;
const HELLO_TEXT = '想加你为联系人';
// 记成来源的几类：人写的话、问我的 Plasticine、别人的 Plasticine 说的话、发来的任务。
const SOURCE_KINDS: readonly EnvelopeKind[] = ['hello', 'text', 'ai_text', 'ask_ai', 'task_offer'];

function hasMessage(value: { text: string; attachments?: readonly unknown[] }): boolean {
  return value.text.trim() !== '' || (value.attachments?.length ?? 0) > 0;
}

/** 对过格式的明文，按 kind 收窄类型。 */
function parsePlaintext(kind: EnvelopeKind, value: unknown): AnyPlaintext | null {
  switch (kind) {
    case 'hello':
      return Value.Check(PLAINTEXT_SCHEMAS.hello, value) ? { kind, body: value } : null;
    case 'text':
      return Value.Check(PLAINTEXT_SCHEMAS.text, value) && hasMessage(value) ? { kind, body: value } : null;
    case 'ai_text':
      return Value.Check(PLAINTEXT_SCHEMAS.ai_text, value) && hasMessage(value) ? { kind, body: value } : null;
    case 'ask_ai':
      return Value.Check(PLAINTEXT_SCHEMAS.ask_ai, value) && hasMessage(value) ? { kind, body: value } : null;
    case 'task_offer':
      return Value.Check(PLAINTEXT_SCHEMAS.task_offer, value) ? { kind, body: value } : null;
    case 'task_reply':
      return Value.Check(PLAINTEXT_SCHEMAS.task_reply, value) ? { kind, body: value } : null;
    case 'task_delivery':
      return Value.Check(PLAINTEXT_SCHEMAS.task_delivery, value) ? { kind, body: value } : null;
    case 'task_verdict':
      return Value.Check(PLAINTEXT_SCHEMAS.task_verdict, value) ? { kind, body: value } : null;
    case 'read':
      return Value.Check(PLAINTEXT_SCHEMAS.read, value) ? { kind, body: value } : null;
    case 'profile':
      return Value.Check(PLAINTEXT_SCHEMAS.profile, value) ? { kind, body: value } : null;
    case 'group_update':
      return Value.Check(PLAINTEXT_SCHEMAS.group_update, value) ? { kind, body: value } : null;
    case 'group_message':
      return Value.Check(PLAINTEXT_SCHEMAS.group_message, value) && hasMessage(value) ? { kind, body: value } : null;
    case 'group_task':
      return Value.Check(PLAINTEXT_SCHEMAS.group_task, value) ? { kind, body: value } : null;
    case 'task_claim':
      return Value.Check(PLAINTEXT_SCHEMAS.task_claim, value) ? { kind, body: value } : null;
    case 'task_cancel':
      return Value.Check(PLAINTEXT_SCHEMAS.task_cancel, value) ? { kind, body: value } : null;
    case 'reaction':
      return Value.Check(PLAINTEXT_SCHEMAS.reaction, value) ? { kind, body: value } : null;
  }
}

/** 群里的表情：发件人确实在这个群里才算这个群的。 */
function reactionGroup(state: NetworkContext['state'], sender: Contact, groupId: string | undefined): string | null {
  if (groupId === undefined) return null;
  const member = state.groupMembers.get(groupId, sender.accountId);
  return member !== undefined && member.leftAt === null ? groupId : null;
}

function sameKeys(contact: Contact, account: NetAccount): boolean {
  return contact.signingKey === account.signingKey && contact.encryptionKey === account.encryptionKey;
}

export class Inbound {
  readonly #context: NetworkContext;

  constructor(context: NetworkContext) {
    this.#context = context;
  }

  async receive(identity: NetworkIdentity, envelopes: readonly Envelope[]): Promise<InboundOutcome> {
    const outcome: InboundOutcome = { ackIds: [], questions: [], groupQuestions: [], changes: [] };
    for (const envelope of envelopes) {
      try {
        await this.#one(identity, envelope, outcome);
      } catch (error) {
        // 连不上中继（查不到发件人的公钥）：这封不确认，下次同步再来。
        if (error instanceof RelayCallError) {
          throw error;
        }
        safeLog('error', 'network_envelope_failed', { objectId: envelope.id, category: errorCategory(error) });
        this.#note(envelope.from, NOTES.failed, outcome);
      }
      outcome.ackIds.push(envelope.id);
    }
    return outcome;
  }

  async #one(identity: NetworkIdentity, envelope: Envelope, outcome: InboundOutcome): Promise<void> {
    const { state } = this.#context;
    if (envelope.to !== identity.accountId || state.contactMessages.byEnvelope(envelope.id) !== undefined) {
      return;
    }
    const known = state.contacts.byAccount(envelope.from);
    const sender = known === undefined ? await this.#account(identity, envelope.from) : null;
    const signingKey = known?.signingKey ?? sender?.signingKey;
    if (signingKey === undefined) {
      return;
    }
    const opened = openEnvelope(envelope, signingKey, identity.encryptionPrivateKey);
    if (!opened.ok) {
      safeLog('warn', 'network_envelope_rejected', { objectId: envelope.id, stepKey: opened.reason });
      if (known !== undefined) {
        await this.#rejected(identity, known, opened.reason, outcome);
      }
      return;
    }
    const plaintext = parsePlaintext(envelope.kind, opened.plaintext);
    if (plaintext === null) {
      if (known !== undefined) {
        this.#note(known.accountId, NOTES.format, outcome);
      }
      return;
    }
    const accounts = plaintext.kind === 'group_update'
      ? await this.#members(identity, unknownMembers(this.#context, plaintext.body, identity.accountId))
      : new Map<string, NetAccount>();
    const result = this.#context.desk.commit((changes) => this.#apply(changes, envelope, plaintext, known, sender,
      accounts));
    if (result === null) {
      return;
    }
    if (result.group !== null) {
      outcome.changes.push(groupChange(result.group.groupId, result.group.messageIds));
      if (result.group.question !== null) {
        outcome.groupQuestions.push(result.group.question);
      }
      return;
    }
    if (result.message.groupId !== null) {
      outcome.changes.push(groupChange(result.message.groupId, [],
        result.message.taskId === null ? [] : [result.message.taskId]));
      return;
    }
    if (GROUP_KINDS.includes(envelope.kind) || envelope.kind === 'profile') {
      outcome.changes.push(changeOf(result.contact.id));
      return;
    }
    outcome.changes.push(changeOf(result.contact.id, [result.message.id],
      result.message.taskId === null ? [] : [result.message.taskId]));
    if (result.message.kind === 'ask_ai') {
      outcome.questions.push(result.message.id);
    }
    if (SOURCE_KINDS.includes(envelope.kind)) {
      this.#context.recordSource(result.message, result.contact);
    }
  }

  /** 群里新出现的人：向中继查他们的公钥（查不到的跳过，之后收到的信认不出就丢）。 */
  async #members(identity: NetworkIdentity, accountIds: readonly string[]): Promise<Map<string, NetAccount>> {
    const found = new Map<string, NetAccount>();
    for (const accountId of accountIds) {
      const account = await this.#account(identity, accountId);
      if (account !== null) {
        found.set(accountId, account);
      }
    }
    return found;
  }

  async #account(identity: NetworkIdentity, accountId: string): Promise<NetAccount | null> {
    try {
      return await this.#context.relay().accountById(signerOf(identity), accountId);
    } catch (error) {
      if (error instanceof RelayCallError && error.kind === 'refused') {
        return null;
      }
      throw error;
    }
  }

  /** 验签不过：看看中继上的钥匙是不是换了（换了标「安全码变了」，不自动换），然后记一条。 */
  async #rejected(identity: NetworkIdentity, contact: Contact, reason: 'signature' | 'decrypt',
    outcome: InboundOutcome): Promise<void> {
    if (reason === 'signature') {
      const current = await this.#account(identity, contact.accountId);
      if (current !== null && !sameKeys(contact, current)) {
        if (!contact.safetyChanged || contact.pendingSigningKey !== current.signingKey) {
          this.#context.state.contacts.update(contact.id, contact.version, { safetyChanged: true,
            pendingSigningKey: current.signingKey, pendingEncryptionKey: current.encryptionKey });
          this.#note(contact.accountId, NOTES.safety, outcome);
        }
        return;
      }
    }
    this.#note(contact.accountId, NOTES[reason], outcome);
  }

  #note(accountId: string, text: string, outcome: InboundOutcome): void {
    const { state, now } = this.#context;
    const contact = state.contacts.byAccount(accountId);
    if (contact === undefined) {
      return;
    }
    const at = now().toISOString();
    const message = state.contactMessages.create({ contactId: contact.id, direction: 'in', author: 'system',
      kind: 'system', text, payload: null, sentAt: at, status: 'sent', readAt: at });
    outcome.changes.push(changeOf(contact.id, [message.id]));
  }

  #apply(changes: Changes, envelope: Envelope, plaintext: AnyPlaintext, known: Contact | undefined,
    sender: NetAccount | null, accounts: ReadonlyMap<string, NetAccount>): Applied | null {
    const { state, now } = this.#context;
    const at = now().toISOString();
    const quiet = GROUP_KINDS.includes(envelope.kind) || envelope.kind === 'profile' || envelope.kind === 'task_cancel'
      || envelope.kind === 'reaction';
    let contact = known ?? (sender === null ? undefined : this.#stranger(sender, quiet, at));
    if (contact === undefined || contact.state === 'blocked') {
      return null;
    }
    // 聊天按本机收到的时间排：两台机器的钟对不齐时，自己发的和对方发的不会排乱（中继转一手只差几秒）。
    const sentAt = at;
    contact = this.#contactSide(contact, plaintext, at);
    const group = this.#group(changes, contact, plaintext, accounts);
    const content = this.#content(changes, contact, plaintext);
    const task = content.taskId === undefined ? undefined : state.networkTasks.get(content.taskId);
    // 交付和退回沿两端私信传输，仍属于原群任务；否则会把回音顶到一对一聊天里。
    const groupId = group?.groupId ?? (task?.contactId === contact.id ? task.groupId : null)
      ?? (plaintext.kind === 'reaction' ? reactionGroup(state, contact, plaintext.body.groupId) : null);
    const message = state.contactMessages.create({ contactId: contact.id, direction: 'in',
      ...content, sentAt, status: 'sent', envelopeId: envelope.id, groupId,
      ...(envelope.kind === 'read' || quiet ? { readAt: at } : {}) });
    if (plaintext.kind === 'text' || plaintext.kind === 'ask_ai' || plaintext.kind === 'ai_text') {
      state.networkAttachments.receive(plaintext.body.attachments ?? [], contact.accountId,
        contact.id, message.id, false);
    }
    contact = state.contacts.require(contact.id);
    if (sentAt > contact.lastAt && envelope.kind !== 'read' && !quiet && groupId === null) {
      contact = state.contacts.update(contact.id, contact.version, { lastAt: sentAt });
    }
    return { contact, message, group };
  }

  /**
   * 不认识的人来信：人话建一条请求；群里的信只认在我某个群里的人（记成 member），别的不建。
   */
  #stranger(sender: NetAccount, quiet: boolean, at: string): Contact | undefined {
    const { state } = this.#context;
    if (quiet && state.groupMembers.groupsOf(sender.id).length === 0) {
      return undefined;
    }
    return state.contacts.create({ accountId: sender.id, handle: sender.handle, displayName: sender.displayName,
      signingKey: sender.signingKey, encryptionKey: sender.encryptionKey, state: quiet ? 'member' : 'request',
      lastAt: at });
  }

  /** 群的那几类：改群、群里的一句、群任务卡、认领。不是这几类是 null。 */
  #group(changes: Changes, contact: Contact, plaintext: AnyPlaintext, accounts: ReadonlyMap<string, NetAccount>):
    GroupReceipt | null {
    switch (plaintext.kind) {
      case 'group_update':
        return receiveGroupUpdate(this.#context, contact, plaintext.body, accounts);
      case 'group_message':
        return receiveGroupMessage(this.#context, contact, plaintext.body);
      case 'group_task': {
        const received = receiveGroupTask(this.#context, changes, contact, plaintext.body);
        return received === null ? null : { groupId: received.groupId, messageIds: received.messageIds,
          question: null };
      }
      case 'task_claim': {
        const claimed = receiveClaim(this.#context, changes, contact, plaintext.body);
        return claimed === null ? null : { groupId: claimed.groupId, messageIds: [], question: null };
      }
      default:
        return null;
    }
  }

  /** 信带来的联系人变化：我加过的人回了话就算互加了；hello 让「先不理」的请求重新出现。 */
  #contactSide(contact: Contact, plaintext: AnyPlaintext, at: string): Contact {
    const { state } = this.#context;
    if (plaintext.kind === 'hello') {
      // 只在群里见过的人来加我：成了一条请求。
      const next = contact.state === 'pending' ? 'active' : contact.state === 'member' ? 'request' : contact.state;
      return state.contacts.update(contact.id, contact.version, { displayName: plaintext.body.displayName,
        ignoredAt: null, state: contact.removedAt === null ? next : 'request', lastAt: at, removedAt: null,
        ...(plaintext.body.avatar === undefined ? {} : { avatar: plaintext.body.avatar }),
        ...(plaintext.body.aiName === undefined ? {} : { aiName: plaintext.body.aiName }) });
    }
    if (plaintext.kind === 'profile') {
      return state.contacts.update(contact.id, contact.version, { displayName: plaintext.body.displayName,
        avatar: plaintext.body.avatar,
        ...(plaintext.body.aiName === undefined ? {} : { aiName: plaintext.body.aiName }) });
    }
    // 删掉的人再来信：变成一条加好友请求（第 12 批）。
    if (contact.removedAt !== null && ['text', 'ai_text', 'ask_ai', 'task_offer'].includes(plaintext.kind)) {
      return state.contacts.update(contact.id, contact.version, { removedAt: null, state: 'request',
        ignoredAt: null, relation: 'stranger' });
    }
    if (contact.state === 'pending' && ['text', 'ai_text', 'ask_ai', 'task_offer'].includes(plaintext.kind)) {
      return state.contacts.update(contact.id, contact.version, { state: 'active' });
    }
    return contact;
  }

  #content(changes: Changes, contact: Contact, plaintext: AnyPlaintext): {
    author: MessageAuthor; kind: EnvelopeKind; text: string; payload: Record<string, unknown>;
    exchangeId?: string; taskId?: string;
  } {
    const { kind } = plaintext;
    const payload: Record<string, unknown> = { ...plaintext.body };
    switch (plaintext.kind) {
      case 'hello':
        return { author: 'them', kind, text: plaintext.body.note ?? HELLO_TEXT, payload };
      case 'text':
        return { author: plaintext.body.toOwnAi === true ? 'them' : 'them', kind, text: plaintext.body.text, payload };
      case 'ai_text':
        return { author: 'their_ai', kind, text: plaintext.body.text, payload, exchangeId: plaintext.body.exchangeId };
      case 'ask_ai':
        return { author: plaintext.body.fromAi ? 'their_ai' : 'them', kind, text: plaintext.body.text, payload,
          exchangeId: plaintext.body.exchangeId };
      case 'task_offer':
        receiveOffer(this.#context, changes, contact, plaintext.body);
        return { author: 'them', kind, text: plaintext.body.title, payload, taskId: plaintext.body.taskId };
      case 'task_reply':
        receiveReply(this.#context, contact, plaintext.body);
        return { author: 'them', kind, text: plaintext.body.decision, payload, taskId: plaintext.body.taskId };
      case 'task_delivery':
        receiveDelivery(this.#context, changes, contact, plaintext.body);
        return { author: 'them', kind, text: plaintext.body.text, payload, taskId: plaintext.body.taskId };
      case 'task_verdict':
        receiveVerdict(this.#context, changes, contact, plaintext.body);
        return { author: 'them', kind, text: plaintext.body.note, payload, taskId: plaintext.body.taskId };
      case 'task_cancel':
        receiveCancel(this.#context, changes, contact, plaintext.body);
        return { author: 'them', kind, text: '撤回了任务', payload, taskId: plaintext.body.taskId };
      case 'read':
        return { author: 'them', kind, text: '', payload };
      case 'profile':
        return { author: 'them', kind, text: '', payload };
      case 'group_update':
        return { author: 'them', kind, text: plaintext.body.name, payload };
      case 'group_message':
        return { author: 'them', kind, text: plaintext.body.text, payload };
      case 'group_task':
      case 'task_claim':
        return { author: 'them', kind, text: '', payload, taskId: plaintext.body.taskId };
      case 'reaction':
        return { author: 'them', kind, text: '', payload };
    }
  }
}
