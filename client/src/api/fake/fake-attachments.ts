import { Value } from 'typebox/value';
import type { AttachmentsApi } from '../client.ts';
import { ApiError } from '../errors.ts';
import { UploadAttachmentRequestSchema, type AttachmentView, type UploadAttachmentRequest } from '../shared.ts';
import type { FakeSession } from './fake-session.ts';

export class FakeAttachments implements AttachmentsApi {
  private readonly session: FakeSession;
  private readonly now: () => Date;
  private readonly rows = new Map<string, AttachmentView>();
  private readonly contents = new Map<string, string>();
  private readonly requests = new Map<string, string>();

  constructor(session: FakeSession, now: () => Date) {
    this.session = session;
    this.now = now;
  }

  async upload(input: UploadAttachmentRequest): Promise<AttachmentView> {
    this.session.require();
    if (!Value.Check(UploadAttachmentRequestSchema, input)) {
      throw new ApiError({ kind: 'failed', code: 'invalid_request', message: '附件格式或大小不合要求。' });
    }
    const previous = this.requests.get(input.requestId);
    if (previous !== undefined) {
      const row = this.require(previous);
      if (row.sha256 !== input.sha256 || row.bytes !== input.bytes) {
        throw new ApiError({ kind: 'conflict', code: 'duplicate', message: '上传标识已用于另一份内容。' });
      }
      return row;
    }
    const id = `attachment-${input.requestId}`;
    const row: AttachmentView = {
      id,
      name: input.name,
      mimeType: input.mimeType,
      bytes: input.bytes,
      sha256: input.sha256,
      status: 'ready',
      truncated: false,
      error: null,
      createdAt: this.now().toISOString(),
      summary: null,
    };
    this.rows.set(id, row);
    this.contents.set(id, input.content);
    this.requests.set(input.requestId, id);
    return row;
  }

  async get(id: string): Promise<AttachmentView> {
    this.session.require();
    return this.require(id);
  }

  async lookup(requestId: string): Promise<AttachmentView | null> {
    this.session.require();
    const id = this.requests.get(requestId);
    return id === undefined ? null : this.require(id);
  }

  async text(id: string) {
    this.session.require();
    const row = this.require(id);
    const encoded = this.contents.get(id);
    const text = row.status !== 'ready' || row.mimeType.startsWith('image/') || encoded === undefined ? null
      : new TextDecoder().decode(Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)));
    return { text, characters: text === null ? 0 : Array.from(text).length, truncated: row.truncated };
  }

  /** The row if there is one (no error): the weekly summary counts originals that are still kept. */
  peek(id: string): AttachmentView | undefined {
    return this.rows.get(id);
  }

  require(id: string): AttachmentView {
    const row = this.rows.get(id);
    if (row === undefined) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', message: '没有找到附件。' });
    }
    return row;
  }

  contentUrl(id: string): string {
    const row = this.require(id);
    return row.status !== 'ready' ? '' : `data:${row.mimeType};base64,${this.contents.get(id) ?? ''}`;
  }

  async content(id: string): Promise<Blob> {
    const row = this.require(id);
    const bytes = Uint8Array.from(atob(this.contents.get(id) ?? ''), (char) => char.charCodeAt(0));
    return new Blob([bytes], { type: row.mimeType });
  }

  purge(id: string, summary: string): AttachmentView {
    const row = this.require(id);
    this.contents.delete(id);
    const saved = { ...row, name: '已记账付款截图', status: 'deleted' as const, summary };
    this.rows.set(id, saved);
    return saved;
  }
}
