import { Value } from 'typebox/value';
import type { NetworkAttachmentsApi } from '../network-attachments-client.ts';
import { UploadNetworkAttachmentSchema, type NetworkAttachmentView, type UploadNetworkAttachment,
  type ContactMessageView } from '../shared.ts';
import { ApiError } from '../errors.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

export class FakeNetworkAttachments implements NetworkAttachmentsApi {
  readonly rows = new Map<string, NetworkAttachmentView>();
  private readonly data = new Map<string, string>();
  private readonly links = new Map<string, string>();
  private readonly session: FakeSession;
  private readonly receipts: FakeReceipts;
  private readonly retryMessage: (thread: string, message: string) => ContactMessageView;
  constructor(session: FakeSession, receipts: FakeReceipts,
    retryMessage: (thread: string, message: string) => ContactMessageView) {
    this.session = session; this.receipts = receipts; this.retryMessage = retryMessage;
  }
  async upload(input: UploadNetworkAttachment, signal?: AbortSignal, progress?: (fraction: number) => void) {
    this.session.requireUser();
    signal?.throwIfAborted();
    if (!Value.Check(UploadNetworkAttachmentSchema, input)) throw this.error('附件大小或格式不合要求。');
    progress?.(0.5);
    const row = await this.receipts.run('save', input.requestId, JSON.stringify(input), () => {
      const { requestId, content, ...meta } = input;
      const value: NetworkAttachmentView = { ...meta, id: `media-${requestId}`, status: 'ready', error: null };
      this.rows.set(value.id, value); this.data.set(value.id, content);
      return value;
    });
    progress?.(1);
    return row;
  }
  bind(ids: readonly string[], thread: string, message: string): NetworkAttachmentView[] {
    return ids.map((id) => {
      const row = this.rows.get(id);
      if (row === undefined) throw this.error('没有这份附件。');
      this.links.set(id, `${thread}:${message}`);
      return structuredClone(row);
    });
  }
  seed(row: NetworkAttachmentView, content: string, thread: string, message: string): void {
    this.rows.set(row.id, row); this.data.set(row.id, content); this.links.set(row.id, `${thread}:${message}`);
  }
  contentUrl(thread: string, message: string, id: string): string {
    const row = this.require(thread, message, id);
    return `data:${row.mimeType};base64,${this.data.get(id) ?? ''}`;
  }
  async content(thread: string, message: string, id: string): Promise<Blob> {
    this.session.require();
    const row = this.require(thread, message, id);
    const bytes = Uint8Array.from(atob(this.data.get(id) ?? ''), (letter) => letter.charCodeAt(0));
    return new Blob([bytes], { type: row.mimeType });
  }
  async retry(thread: string, message: string, requestId: string): Promise<ContactMessageView> {
    this.session.requireUser();
    return this.receipts.run('contacts', requestId, `retry:${thread}:${message}`,
      () => this.retryMessage(thread, message));
  }
  private require(thread: string, message: string, id: string): NetworkAttachmentView {
    const row = this.rows.get(id);
    if (row === undefined || this.links.get(id) !== `${thread}:${message}`) throw this.error('这段对话里没有这份附件。');
    return row;
  }
  private error(message: string): ApiError {
    return new ApiError({ kind: 'invalid', status: 400, code: 'invalid_request', message });
  }
}
