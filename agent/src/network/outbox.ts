import type { Envelope, EnvelopeKind, NetTaskStatus, Plaintext } from '../../shared/net-wire.ts';
import type { MessageAuthor } from '../../shared/api/contacts.ts';
import type { Contact, ContactMessage } from '../../shared/state.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { changeOf, groupChange, requireIdentity, signerOf, touchContact, type NetworkContext } from './context.ts';
import { sealEnvelope } from '../../protocol/crypto.ts';
import { RelayCallError } from '../../protocol/relay-client.ts';
import { cleanOutboundJson, settleMessageOutbound, settleNetworkOutbound } from '../outbound/index.ts';

export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_RETRY_BASE_MS = 5_000;
export const OUTBOX_RETRY_MAX_MS = 10 * 60 * 1000;
const OUTBOX_BATCH = 50;
const ERROR_TEXT_MAX = 300;

export interface Outgoing<K extends EnvelopeKind = EnvelopeKind> {
  kind: K;
  author: MessageAuthor;
  text: string;
  payload: Plaintext<K>;
  exchangeId?: string | null;
  taskId?: string | null;
  requestId?: string | null;
  groupId?: string | null;
  quiet?: boolean;
}

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

  flush(signal?: AbortSignal): Promise<number> {
    this.#running ??= this.#flush(signal).finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

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
      this.#settle(message, 'failed', '这一条只记在本机，不发。');
      return false;
    }
    const envelope: Envelope = sealEnvelope({
      id: message.envelopeId ?? message.id,
      from: identity.accountId,
      to: contact.accountId,
      sentAt: message.sentAt,
      kind: message.kind,
      plaintext: cleanOutboundJson(message.payload ?? {}),
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
    const status = message.groupId === null ? relayStatusOf(message) : null;
    if (status !== null && message.taskId !== null) {
      try {
        await context.relay().taskStatus(signer, message.taskId, status, contact.accountId);
      } catch (error) {
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
    if (message.taskId !== null) { settleNetworkOutbound(state, message.taskId); }
    const tasks = message.taskId === null ? [] : [message.taskId];
    const wireId = message.payload?.['messageId'];
    const groupMessage = message.groupId !== null && message.kind === 'group_message' && typeof wireId === 'string'
      ? state.groupMessages.byMessageId(message.groupId, wireId) : undefined;
    settleMessageOutbound(state, `network-message:${message.id}`);
    if (groupMessage !== undefined) settleMessageOutbound(state, `network-group-message:${groupMessage.id}`);
    this.#context.changed(message.groupId === null ? changeOf(message.contactId, [message.id], tasks)
      : groupChange(message.groupId, groupMessage === undefined ? [] : [groupMessage.id], tasks));
  }
}
