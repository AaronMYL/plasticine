import type { AttachmentsApi } from '../client.ts';
import {
  ATTACHMENT_CHUNK_BYTES,
  ATTACHMENT_UPLOADS_PATH,
  ATTACHMENTS_PATH,
  AttachmentChunkResultSchema,
  AttachmentUploadSchema,
  AttachmentViewSchema,
  AttachmentLookupSchema,
  AttachmentTextViewSchema,
  attachmentChunkPath,
  attachmentCompletePath,
  type AttachmentView,
  type UploadAttachmentMeta,
} from '../shared.ts';
import type { Transport } from './transport.ts';

const CHUNK_TIMEOUT_MS = 120_000;
const COMPLETE_TIMEOUT_MS = 90_000;

export class HttpAttachments implements AttachmentsApi {
  private readonly transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }

  async upload(meta: UploadAttachmentMeta, data: Blob, signal?: AbortSignal,
    onProgress?: (fraction: number) => void): Promise<AttachmentView> {
    const opened = await this.transport.request({ method: 'POST', path: ATTACHMENT_UPLOADS_PATH, body: meta, signal,
      schema: AttachmentUploadSchema, what: '上传附件', lostAs: 'uncertain' });
    const { id, status } = opened.attachment;
    if (status !== 'uploading') return opened.attachment;
    let received = opened.received;
    const report = (done: number): void => onProgress?.(meta.bytes === 0 ? 1 : Math.min(1, done / meta.bytes));
    report(received);
    let stalled = 0;
    while (received < meta.bytes) {
      const from = received;
      const chunk = data.slice(from, Math.min(meta.bytes, from + ATTACHMENT_CHUNK_BYTES));
      const result = await this.transport.request({ method: 'PUT', path: attachmentChunkPath(id, from),
        binaryBody: chunk, signal, schema: AttachmentChunkResultSchema, what: '上传附件', lostAs: 'uncertain',
        timeoutMs: CHUNK_TIMEOUT_MS, onUploadProgress: (fraction) => report(from + fraction * chunk.size) });
      received = result.received;
      stalled = received > from ? 0 : stalled + 1;
      if (stalled >= 3) throw new Error('附件传不上去：服务端一直没收下这一块，请重新上传。');
      report(received);
    }
    return this.transport.request({ method: 'POST', path: attachmentCompletePath(id), signal,
      schema: AttachmentViewSchema, what: '上传附件', lostAs: 'uncertain', timeoutMs: COMPLETE_TIMEOUT_MS });
  }

  get(id: string, signal?: AbortSignal) {
    return this.transport.request({
      method: 'GET',
      path: `${ATTACHMENTS_PATH}/${encodeURIComponent(id)}`,
      signal,
      schema: AttachmentViewSchema,
      what: '读附件',
      lostAs: 'failed',
    });
  }

  contentUrl(id: string): string {
    return `${ATTACHMENTS_PATH}/${encodeURIComponent(id)}/content`;
  }

  content(id: string, signal?: AbortSignal): Promise<Blob> {
    return this.transport.blob(this.contentUrl(id), signal);
  }

  text(id: string, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: `${ATTACHMENTS_PATH}/${encodeURIComponent(id)}/text`,
      signal, schema: AttachmentTextViewSchema, what: '读已抽取正文', lostAs: 'failed' });
  }

  lookup(requestId: string, signal?: AbortSignal) {
    return this.transport.request({
      method: 'GET',
      path: `${ATTACHMENTS_PATH}/requests/${requestId}`,
      signal,
      schema: AttachmentLookupSchema,
      what: '核实上传',
      lostAs: 'failed',
    });
  }
}
