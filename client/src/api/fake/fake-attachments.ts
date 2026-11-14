import { Value } from 'typebox/value';
import type { AttachmentsApi } from '../client.ts';
import { ApiError } from '../errors.ts';
import { UploadAttachmentMetaSchema, type AttachmentView, type UploadAttachmentMeta } from '../shared.ts';
import type { FakeSession } from './fake-session.ts';

function base64Of(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let at = 0; at < bytes.length; at += 8192) chunks.push(String.fromCharCode(...bytes.subarray(at, at + 8192)));
  return btoa(chunks.join(''));
}

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

  async upload(meta: UploadAttachmentMeta, data: Blob, _signal?: AbortSignal,
    onProgress?: (fraction: number) => void): Promise<AttachmentView> {
    this.session.require();
    if (!Value.Check(UploadAttachmentMetaSchema, meta) || data.size !== meta.bytes) {
      throw new ApiError({ kind: 'failed', code: 'invalid_request', message: '附件格式或大小不合要求。' });
    }
    const previous = this.requests.get(meta.requestId);
    if (previous !== undefined) {
      const row = this.require(previous);
      if (row.sha256 !== meta.sha256 || row.bytes !== meta.bytes) {
        throw new ApiError({ kind: 'conflict', code: 'duplicate', message: '上传标识已用于另一份内容。' });
      }
      return row;
    }
    const content = base64Of(new Uint8Array(await data.arrayBuffer()));
    onProgress?.(1);
    const id = `attachment-${meta.requestId}`;
    const row: AttachmentView = {
      id,
      name: meta.name,
      mimeType: meta.mimeType,
      bytes: meta.bytes,
      sha256: meta.sha256,
      status: 'ready',
      truncated: false,
      error: null,
      createdAt: this.now().toISOString(),
      summary: null,
    };
    this.rows.set(id, row);
    this.contents.set(id, content);
    this.requests.set(meta.requestId, id);
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
    const readable = row.mimeType.startsWith('text/') || row.mimeType === 'application/json';
    const text = row.status !== 'ready' || !readable || encoded === undefined ? null
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

  /** 场景种子：放一张现成的图。 */
  seedImage(id: string, name: string, mimeType: AttachmentView['mimeType'], base64: string): void {
    this.rows.set(id, { id, name, mimeType, bytes: Math.floor(base64.length * 3 / 4), sha256: '0'.repeat(64),
      status: 'ready', truncated: false, error: null, createdAt: this.now().toISOString(), summary: null });
    this.contents.set(id, base64);
  }

  purge(id: string, summary: string): AttachmentView {
    const row = this.require(id);
    this.contents.delete(id);
    const saved = { ...row, name: '已记账付款截图', status: 'deleted' as const, summary };
    this.rows.set(id, saved);
    return saved;
  }
}
