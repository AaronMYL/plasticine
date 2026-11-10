import type { AttachmentsApi } from '../client.ts';
import {
  ATTACHMENTS_PATH,
  AttachmentViewSchema,
  AttachmentLookupSchema,
  AttachmentTextViewSchema,
  type UploadAttachmentRequest,
} from '../shared.ts';
import type { Transport } from './transport.ts';

export class HttpAttachments implements AttachmentsApi {
  private readonly transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }

  upload(input: UploadAttachmentRequest, signal?: AbortSignal, onProgress?: (fraction: number) => void) {
    return this.transport.request({
      method: 'POST',
      path: ATTACHMENTS_PATH,
      body: input,
      signal,
      schema: AttachmentViewSchema,
      what: '上传附件',
      lostAs: 'uncertain',
      timeoutMs: 60_000,
      ...(onProgress === undefined ? {} : { onUploadProgress: onProgress }),
    });
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
