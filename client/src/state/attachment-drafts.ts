import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { AttachmentsApi } from '../api/client.ts';
import { errorText } from '../api/errors.ts';
import { createRequestId } from '../api/request-id.ts';
import {
  AttachmentViewSchema,
  UploadAttachmentMetaSchema,
  attachmentMime,
  CONVERSATION_ATTACHMENT_MAX_BYTES,
  CONVERSATION_ATTACHMENT_MAX_COUNT,
  type AttachmentView,
  type AttachmentMime,
} from '../api/shared.ts';
import type { ActionOps } from './action-ops.ts';
import { AttachmentBytes, readFileBytes, base64Of } from './attachment-bytes.ts';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

const DraftSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  canceled: Type.Boolean(),
  status: Type.Enum(['reading', 'uploading', 'ready', 'failed']),
  error: Type.Union([Type.String(), Type.Null()]),
  meta: Type.Union([UploadAttachmentMetaSchema, Type.Null()]),
  remote: Type.Union([AttachmentViewSchema, Type.Null()]),
  bytes: Type.Optional(Type.Number()),
  mimeType: Type.Optional(Type.String()),
  progress: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
});
export type AttachmentDraft = Static<typeof DraftSchema>;
type Draft = AttachmentDraft;
const DraftsSchema = Type.Array(DraftSchema);
const STORAGE_KEY = 'plasticine.attachment-drafts';

function read(storage: KeyValueStorage | null): Draft[] {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw == null) {
      return [];
    }
    const value: unknown = JSON.parse(raw);
    if (!Value.Check(DraftsSchema, value)) {
      return [];
    }
    return value.map((item) =>
      item.status === 'uploading' || item.status === 'reading'
        ? { ...item, status: 'failed', error: '页面重新载入，请核实这份附件。' }
        : item,
    );
  } catch {
    console.warn('附件草稿列表未读到，请核对待发资料。');
    return [];
  }
}

export class AttachmentDrafts {
  readonly store: Store<readonly Draft[]>;
  readonly error = new Store<string | null>(null);
  private readonly storage: KeyValueStorage | null;
  private readonly ops: ActionOps;
  private readonly bytes: AttachmentBytes;
  private readonly controllers = new Map<string, AbortController>();
  private readonly previews = new Map<string, string>();
  private readonly files = new Map<string, File>();

  constructor(storage: KeyValueStorage | null, ops: ActionOps, bytes = new AttachmentBytes()) {
    this.storage = storage;
    this.ops = ops;
    this.bytes = bytes;
    this.store = new Store<readonly Draft[]>(read(storage));
    this.store.subscribe(() => {
      try {
        this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.store.get()));
      } catch {
        this.error.set('附件草稿列表没有存好，请保留页面并重试。');
      }
    });
  }

  active(): readonly Draft[] {
    return this.store.get().filter((item) => !item.canceled);
  }
  hasAny(): boolean {
    return this.store.get().length > 0;
  }
  ready(): boolean {
    return this.active().every((item) => item.status === 'ready');
  }

  preview(id: string): string | null {
    return this.previews.get(id) ?? null;
  }

  replace(id: string, file: File, api: AttachmentsApi): Promise<void> {
    return this.add([file], api, id);
  }

  async add(files: File[], api: AttachmentsApi, replaceId?: string): Promise<void> {
    this.error.set(null);
    const replaceAt = replaceId === undefined ? -1 : this.active().findIndex((row) => row.id === replaceId);
    if (replaceId !== undefined && replaceAt === -1) return;
    if (this.active().length + files.length - Number(replaceAt !== -1) > CONVERSATION_ATTACHMENT_MAX_COUNT) {
      this.error.set('一条消息最多 5 份附件。');
      return;
    }
    const reserved: { file: File; id: string; mimeType: AttachmentMime }[] = [];
    for (const file of files) {
      const mimeType = attachmentMime(file.type, file.name);
      if (
        mimeType === null ||
        file.size === 0 ||
        file.size > CONVERSATION_ATTACHMENT_MAX_BYTES
      ) {
        this.error.set('只支持 PNG、JPEG、WebP、纯文本和 PDF；每份最多 10 MiB，不能是空文件。');
        continue;
      }
      const id = createRequestId();
      if (replaceId !== undefined) this.cancel(replaceId);
      this.files.set(id, file);
      if (mimeType.startsWith('image/') && typeof URL.createObjectURL === 'function') {
        this.previews.set(id, URL.createObjectURL(file));
      }
      this.store.set((items) => {
        const row: Draft = {
          id,
          name: file.name.slice(0, 200),
          canceled: false,
          status: 'reading',
          error: null,
          meta: null,
          remote: null,
          bytes: file.size,
          mimeType,
        };
        return replaceAt === -1 ? [...items, row] : items.toSpliced(replaceAt, 0, row);
      });
      reserved.push({ file, id, mimeType });
    }
    for (const { file, id, mimeType } of reserved) await this.prepare(file, id, mimeType, api);
  }

  private async prepare(file: File, id: string, mimeType: AttachmentMime, api: AttachmentsApi): Promise<void> {
    this.patch(id, { status: 'reading', error: null });
    try {
      const buffer = await readFileBytes(file);
      const hash = await crypto.subtle.digest('SHA-256', buffer);
      const sha256 = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const content = base64Of(buffer);
      if (this.find(id)?.canceled || this.find(id) === undefined) {
        return;
      }
      this.patch(id, {
        meta: {
          requestId: id,
          name: file.name.slice(0, 200),
          mimeType: mimeType as AttachmentMime,
          bytes: file.size,
          sha256,
        },
      });
      await this.bytes.put(id, content);
      if (this.find(id) === undefined || this.find(id)?.canceled) {
        await this.bytes.remove(id);
        return;
      }
      await this.retry(id, api);
    } catch (cause) {
      this.patch(id, { status: 'failed', error: errorText(cause) });
    }
  }

  async retry(id: string, api: AttachmentsApi): Promise<void> {
    const draft = this.find(id);
    if (draft === undefined || this.controllers.has(id)) return;
    if (draft.meta === null) {
      const file = this.files.get(id);
      const mime = file === undefined ? null : attachmentMime(file.type, file.name);
      if (draft.status === 'failed' && file !== undefined && mime !== null) await this.prepare(file, id, mime, api);
      return;
    }
    const key = `attachment:${id}:upload`;
    if (draft.canceled) {
      try {
        const current = await api.lookup(draft.meta.requestId);
        if (current?.status === 'uploading') {
          this.patch(id, { error: '服务端仍在处理，请稍后再核实。' });
        } else {
          this.ops.succeed(key);
          this.remove(id);
        }
      } catch (cause) {
        this.patch(id, { error: errorText(cause) });
      }
      return;
    }
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.patch(id, { status: 'uploading', error: null, progress: 0 });
    const request = this.ops.begin(
      key,
      '上传附件',
      '你选择的资料',
      (requestId) => ({
        kind: 'attachment_upload',
        fileId: id,
        body: { ...draft.meta!, requestId },
      }),
      () => draft.meta!.requestId,
    );
    try {
      if (request.kind !== 'attachment_upload') {
        throw new Error('附件操作不匹配。');
      }
      const content = await this.bytes.get(id);
      if (content === null) {
        throw new Error('没有读到附件草稿原件，请移除这一项后重新选择。');
      }
      // 暂存此前失败时，重试先确保存好；哈希及原请求不变。
      await this.bytes.put(id, content);
      const remote = await api.upload({ ...request.body, content }, controller.signal,
        (fraction) => this.patch(id, { progress: Math.max(0, Math.min(1, fraction)) }));
      this.ops.succeed(key);
      if (this.find(id)?.canceled) {
        this.remove(id);
      } else {
        this.patch(id, { remote, status: remote.status === 'ready' ? 'ready' : 'failed', error: remote.error });
      }
    } catch (cause) {
      if (this.find(id) === undefined) {
        this.ops.succeed(key);
      } else {
        this.ops.fail(key, cause);
        this.patch(id, { status: 'failed', error: errorText(cause) });
      }
    } finally {
      this.controllers.delete(id);
    }
  }

  cancel(id: string): void {
    this.controllers.get(id)?.abort();
    this.ops.succeed(`attachment:${id}:upload`);
    this.remove(id);
  }

  /** 只移除本地待发引用，服务端原件继续保留；迟到回执不把草稿加回来。 */
  dismiss(id: string): void {
    this.controllers.get(id)?.abort();
    this.ops.fail(`attachment:${id}:upload`, new Error('已从本地待发资料移除。'));
    this.ops.dismiss(`attachment:${id}:upload`);
    this.remove(id);
  }

  takeReady(): AttachmentView[] {
    if (!this.ready()) {
      return [];
    }
    const rows = this.active().flatMap((item) => (item.remote === null ? [] : [item.remote]));
    for (const draft of this.active()) {
      this.remove(draft.id);
    }
    return rows;
  }

  restoreRemote(rows: AttachmentView[]): void {
    const known = new Set(this.active().map((item) => item.remote?.id));
    this.store.set((items) => [
      ...items,
      ...rows
        .filter((row) => !known.has(row.id))
        .map(
          (row): Draft => ({
            id: createRequestId(),
            name: row.name,
            status: row.status === 'ready' ? 'ready' : 'failed',
            remote: row,
            meta: null,
            error: row.error,
            canceled: false,
          }),
        ),
    ]);
  }

  private find(id: string): Draft | undefined {
    return this.store.get().find((item) => item.id === id);
  }
  private patch(id: string, patch: Partial<Draft>): void {
    this.store.set((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }
  private remove(id: string): void {
    const preview = this.previews.get(id);
    if (preview !== undefined) URL.revokeObjectURL(preview);
    this.previews.delete(id);
    this.files.delete(id);
    this.store.set((items) => items.filter((item) => item.id !== id));
    void this.bytes.remove(id).catch(() => this.error.set('附件暂存清理未完成，请保留页面后重试。'));
  }
}
