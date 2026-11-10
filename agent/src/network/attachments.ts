import type { ImageContent } from '@earendil-works/pi-ai';
import { IMAGE_MAX_BYTES } from '../lines/images.ts';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { EnvelopeSchema, NET_HEADERS, NET_HANDLE_PATTERN, NET_NONCE_TTL_MS, NET_TIME_SKEW_MS, type Envelope }
  from '../../shared/net-wire.ts';
import { NETWORK_ATTACHMENT_CIPHER_MAX, NETWORK_ATTACHMENT_MAX_BYTES, PEER_ATTACHMENTS_PATH }
  from '../../shared/network-attachments.ts';
import { attachmentMime } from '../../shared/attachments.ts';
import { openEnvelope, requestSigningText, sealEnvelope, verifyText } from '../../protocol/crypto.ts';
import { signedHeaders } from '../../protocol/relay-client.ts';
import { extractConversationAttachment, imageMatches } from '../cloud-tools/index.ts';
import type { StateService } from '../state/index.ts';
import { NetworkError } from './errors.ts';

const AttachmentEnvelope = Type.Object({ ...EnvelopeSchema.properties,
  ciphertext: Type.String({ maxLength: NETWORK_ATTACHMENT_CIPHER_MAX, pattern: '^[A-Za-z0-9_-]+$' }),
}, { additionalProperties: false });
const Body = Type.Object({ id: Type.String(), sha256: Type.String(),
  content: Type.String({ maxLength: Math.ceil(NETWORK_ATTACHMENT_MAX_BYTES / 3) * 4,
    pattern: '^[A-Za-z0-9+/]*={0,2}$' }),
}, { additionalProperties: false });

/** 附件原文只留在消息附件表，不进入主线附件库、记忆或全局检索。 */
export async function attachmentText(mimeType: string, name: string, data: Buffer): Promise<string | null> {
  const type = attachmentMime(mimeType, name);
  if (type === null || type.startsWith('image/')) return null;
  if (type.startsWith('text/') || type === 'application/json') {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, 40_000),
        { stream: data.length > 40_000 });
      const chars = Array.from(text);
      return chars.slice(0, 9_000).join('')
        + (data.length > 40_000 || chars.length > 9_000 ? '\n[正文仅提取前 9,000 字]' : '');
    }
    catch { return null; }
  }
  try {
    const result = await extractConversationAttachment(type, data, AbortSignal.timeout(20_000));
    return result.text === null ? null : result.text + (result.truncated ? '\n[正文未完整提取]' : '');
  }
  catch { return null; }
}

export class NetworkAttachments {
  readonly #state: StateService;
  readonly #now: () => Date;
  readonly #host: (handle: string) => string;
  readonly #fetch: typeof fetch;
  readonly #nonces = new Map<string, number>();
  readonly #pending = new Map<string, Promise<Buffer>>();
  constructor(state: StateService, now: () => Date, host: (handle: string) => string, fetcher: typeof fetch) {
    this.#state = state; this.#now = now; this.#host = host; this.#fetch = fetcher;
  }

  contextImages(lineId: string): ImageContent[] {
    const response = this.#state.netResponses.byLine(lineId);
    const line = this.#state.lines.get(lineId);
    if (response === undefined || line?.sealedPrompt == null
      || (line.status !== 'running' && line.status !== 'queued')) return [];
    const threadId = response.groupId ?? response.contactId;
    return this.#state.networkAttachments.forMessage(response.questionId).flatMap((view) => {
      const row = this.#state.networkAttachments.require(view.id);
      const type = attachmentMime(view.mimeType, view.name);
      if (row.threadId !== threadId || type === null || !type.startsWith('image/')
        || view.bytes > IMAGE_MAX_BYTES || view.status !== 'ready') return [];
      const data = this.#state.networkAttachments.bytes(view.id);
      if (data === null || !imageMatches(type, data)) return [];
      return [{ type: 'image' as const, mimeType: type, data: data.toString('base64') }];
    }).slice(0, 5);
  }

  serve(id: string, path: string, headers: Record<string, string | string[] | undefined>): Envelope | null {
    const account = headers[NET_HEADERS.account], time = headers[NET_HEADERS.time];
    const nonce = headers[NET_HEADERS.nonce], signature = headers[NET_HEADERS.signature];
    if (typeof account !== 'string' || typeof time !== 'string' || typeof nonce !== 'string'
      || typeof signature !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(nonce)) return null;
    const contact = this.#state.contacts.byAccount(account);
    const now = this.#now().getTime(), at = Date.parse(time);
    if (contact === undefined || contact.state === 'blocked' || contact.safetyChanged || !Number.isFinite(at)
      || Math.abs(now - at) > NET_TIME_SKEW_MS) return null;
    for (const [key, expiry] of this.#nonces) if (expiry <= now) this.#nonces.delete(key);
    const key = `${account}:${nonce}`;
    if (this.#nonces.has(key) || this.#nonces.size >= 10_000 || !verifyText(contact.signingKey,
      requestSigningText({ method: 'GET', path, time, nonce, body: Buffer.alloc(0) }), signature)) return null;
    this.#nonces.set(key, now + NET_NONCE_TTL_MS);
    const row = this.#state.networkAttachments.get(id);
    if (row === undefined) return null;
    const identity = this.#state.networkIdentity.get();
    if (!row.local || identity === undefined || row.sourceAccountId !== identity.accountId
      || row.messageId === null || !row.recipients.includes(account)) return null;
    if (row.group && (row.threadId === null
      || this.#state.groupMembers.get(row.threadId, account)?.leftAt !== null)) return null;
    const data = this.#state.networkAttachments.bytes(id);
    if (data === null) return null;
    return sealEnvelope({ id: row.remoteId, from: identity.accountId, to: account,
      kind: 'text', sentAt: this.#now().toISOString(), recipientEncryptionKey: contact.encryptionKey,
      senderSigningPrivateKey: identity.signingPrivateKey,
      plaintext: { id: row.remoteId, sha256: row.metadata.sha256, content: data.toString('base64') } });
  }

  async content(id: string, threadId: string, messageId: string): Promise<Buffer> {
    const row = this.#state.networkAttachments.require(id);
    if (row.threadId !== threadId || row.messageId !== messageId) {
      throw new NetworkError('not_found', '这段对话里没有这份附件。');
    }
    const saved = this.#state.networkAttachments.bytes(id);
    if (saved !== null) return saved;
    let pending = this.#pending.get(id);
    if (pending === undefined) {
      pending = this.#download(id).finally(() => this.#pending.delete(id));
      this.#pending.set(id, pending);
    }
    return pending;
  }

  async prepare(messageId: string): Promise<void> {
    for (const view of this.#state.networkAttachments.forMessage(messageId)) {
      const row = this.#state.networkAttachments.require(view.id);
      if (row.threadId === null) continue;
      try { await this.content(view.id, row.threadId, messageId); }
      catch (cause) {
        if (!(cause instanceof NetworkError)) throw cause;
        // 回执仍保留。封闭答话上下文会明确说附件原件未取得，不凭空复述内容。
      }
    }
  }

  async #download(id: string): Promise<Buffer> {
    const store = this.#state.networkAttachments;
    const row = store.require(id);
    const sender = this.#state.contacts.byAccount(row.sourceAccountId);
    const identity = this.#state.networkIdentity.get();
    if (identity === undefined || sender === undefined || sender.state === 'blocked' || sender.safetyChanged
      || !new RegExp(NET_HANDLE_PATTERN).test(sender.handle)) {
      throw new NetworkError('conflict', '发送方身份不可用，请先核对联系人安全码。');
    }
    const path = `${PEER_ATTACHMENTS_PATH}/${encodeURIComponent(row.remoteId)}`;
    try {
      const response = await this.#fetch(`https://${this.#host(sender.handle)}${path}`, { method: 'GET',
        headers: signedHeaders({ accountId: identity.accountId, signingPrivateKey: identity.signingPrivateKey },
          'GET', path, Buffer.alloc(0), this.#now()), redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error('peer-unavailable');
      const chunks: Uint8Array[] = [];
      const reader = response.body?.getReader();
      if (reader === undefined) throw new Error('empty-response');
      let length = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.length;
          if (length > NETWORK_ATTACHMENT_CIPHER_MAX + 4096) throw new Error('oversized-response');
          chunks.push(part.value);
        }
      } finally { await reader.cancel(); }
      const envelope: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Value.Check(AttachmentEnvelope, envelope) || envelope.from !== sender.accountId
        || envelope.to !== identity.accountId || envelope.id !== row.remoteId || envelope.kind !== 'text') {
        throw new Error('wrong-envelope');
      }
      const opened = openEnvelope(envelope, sender.signingKey, identity.encryptionPrivateKey);
      if (!opened.ok || !Value.Check(Body, opened.plaintext) || opened.plaintext.id !== row.remoteId
        || opened.plaintext.sha256 !== row.metadata.sha256) throw new Error('invalid-content');
      const data = Buffer.from(opened.plaintext.content, 'base64');
      store.finish(id, data, await attachmentText(row.metadata.mimeType, row.metadata.name, data));
      return data;
    } catch {
      const message = '附件原件暂时取不到：发送方可能离线，或原件校验未通过。稍后可以重试。';
      store.failed(id, message);
      throw new NetworkError('relay_unreachable', message);
    }
  }
}
