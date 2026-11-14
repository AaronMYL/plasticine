import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, closeSync, createReadStream, linkSync, mkdirSync, openSync, readFileSync, readSync,
  rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { AttachmentViewSchema, type AttachmentView } from '../../shared/attachments.ts';
import type { UploadAttachmentMeta } from '../../shared/api/attachments.ts';
import { checked, readRow } from './codec.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';
import type { Row } from './db.ts';

const Wrapped = Type.Object({ metadata: AttachmentViewSchema });
/** 没传完的分块上传，过了这么久（下次启动时）把收到的那一截清掉。 */
const STALE_PART_MS = 24 * 60 * 60 * 1000;

async function fileDigest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export function createAttachmentStore(context: StoreContext, directory: string | undefined) {
  const { db } = context;
  const read = (row: Row) => readRow(Wrapped, { metadata: 'json' }, row, '附件').metadata;
  const get = (id: string): AttachmentView | null => {
    const row = db.get('SELECT metadata FROM attachments WHERE id = $id', { id });
    return row === undefined ? null : read(row);
  };
  const require = (id: string): AttachmentView => {
    const row = get(id);
    if (row === null) {
      throw new StateError('not_found', '没有找到这份附件。');
    }
    return row;
  };
  const path = (id: string): string => {
    if (directory === undefined || !/^[A-Za-z0-9_-]{1,150}$/.test(id)) {
      throw new StateError('invalid_input', '没有可用的附件存储位置。');
    }
    return join(directory, `${id}.bin`);
  };
  /** 分块上传收到的那一截（传完、核对过摘要才变成 `${id}.bin`）。 */
  const part = (id: string): string => `${path(id)}.part`;
  const received = (row: AttachmentView): number => {
    if (row.status === 'ready') return row.bytes;
    if (row.status !== 'uploading') return 0;
    try {
      return statSync(part(row.id)).size;
    } catch {
      return 0;
    }
  };
  const ensureDirectory = (): void => {
    mkdirSync(directory ?? '', { recursive: true, mode: 0o700 });
    chmodSync(directory ?? '', 0o700);
  };
  const save = (row: AttachmentView, text: string | null): AttachmentView => {
    checked(AttachmentViewSchema, row, 'invalid_input', '附件');
    db.run('UPDATE attachments SET metadata = $metadata, text_content = $text WHERE id = $id', {
      id: row.id,
      metadata: JSON.stringify(row),
      text,
    });
    return row;
  };
  return {
    get,
    require,
    recoverUploads(): AttachmentView[] {
      // 一天前开的、没传完的分块上传：收到的那一截清掉（同一标识再传从头来）。
      const stale = new Date(Date.parse(context.now()) - STALE_PART_MS).toISOString();
      for (const row of db.all("SELECT metadata FROM attachments WHERE json_extract(metadata, '$.status') "
        + "IN ('uploading', 'failed') AND json_extract(metadata, '$.createdAt') < $stale", { stale }).map(read)) {
        rmSync(part(row.id), { force: true });
      }
      return db.transaction(() => db
        .all("SELECT metadata FROM attachments WHERE json_extract(metadata, '$.status') = 'uploading'")
        .map(read)
        .map((row) => save({ ...row, status: 'failed',
          error: '附件上传被重启中断，请重新上传或移除待发引用。' }, null)));
    },
    /** 这份已经收到多少字节（传完的是全部；断了从这里接着传）。 */
    received(id: string): number {
      return received(require(id));
    },
    /**
     * 接上一块。offset 要正好是已经收到的字节数，不是就什么都不写、回现在收到多少（重发的、乱序的块照这个数接着传）；
     * 多出报的大小算错。
     */
    appendChunk(id: string, offset: number, data: Buffer): number {
      const row = require(id);
      if (row.status !== 'uploading') {
        throw new StateError('invalid_input', '这份附件不在上传中，请重新开始上传。');
      }
      const have = received(row);
      if (offset !== have) return have;
      if (data.length === 0 || have + data.length > row.bytes) {
        throw new StateError('invalid_input', '这一块超出了报的文件大小。');
      }
      ensureDirectory();
      appendFileSync(part(id), data, { mode: 0o600 });
      return have + data.length;
    },
    /** 传完了：核对大小和摘要，对上了存成原件（状态还是上传中，读完正文再 finish）；摘要不对就清掉重传。 */
    async completeUpload(id: string): Promise<AttachmentView> {
      const row = require(id);
      if (row.status === 'ready') return row;
      if (row.status !== 'uploading') {
        throw new StateError('invalid_input', '这份附件不在上传中，请重新开始上传。');
      }
      const have = received(row);
      if (have !== row.bytes) {
        throw new StateError('invalid_input', `附件还没传完（收到 ${have} / ${row.bytes} 字节）。`);
      }
      const source = part(id);
      if (await fileDigest(source) !== row.sha256) {
        rmSync(source, { force: true });
        throw new StateError('invalid_input', '附件传的时候坏了（摘要对不上），请重新上传。');
      }
      const target = path(id);
      try {
        linkSync(source, target);
      } catch (cause) {
        if (!(cause instanceof Error && 'code' in cause && cause.code === 'EEXIST')) {
          throw new StateError('invalid_input', '附件原件没有存好，请用同一标识重试。');
        }
        if (await fileDigest(target) !== row.sha256) {
          throw new StateError('corrupt_record', '附件原件校验不通过。');
        }
      } finally {
        rmSync(source, { force: true });
      }
      return row;
    },
    /** 读刚存好的原件开头 limit 个字节（读正文用，还没 finish 也能读）。 */
    readStored(id: string, limit: number): Buffer {
      const handle = openSync(path(id), 'r');
      try {
        const buffer = Buffer.alloc(Math.max(0, Math.min(limit, statSync(path(id)).size)));
        let at = 0;
        while (at < buffer.length) {
          const read = readSync(handle, buffer, at, buffer.length - at, at);
          if (read === 0) break;
          at += read;
        }
        return buffer.subarray(0, at);
      } finally {
        closeSync(handle);
      }
    },
    findUpload(requestId: string): AttachmentView | null {
      const row = db.get('SELECT metadata FROM attachments WHERE request_id = $requestId', { requestId });
      return row === undefined ? null : read(row);
    },
    open(input: UploadAttachmentMeta, ownerId: string): AttachmentView {
      return db.transaction(() => {
        const previous = db.get('SELECT id FROM attachments WHERE request_id = $requestId', {
          requestId: input.requestId,
        });
        if (previous !== undefined) {
          const row = require(String(previous['id']));
          const owner = db.get('SELECT owner_id FROM attachments WHERE id = $id', { id: row.id });
          if (
            owner?.['owner_id'] !== ownerId ||
            row.sha256 !== input.sha256 ||
            row.bytes !== input.bytes ||
            row.mimeType !== input.mimeType
          ) {
            throw new StateError('duplicate', '这个上传标识已经用于另一份内容。');
          }
          return row.status === 'failed' ? save({ ...row, status: 'uploading', error: null }, null) : row;
        }
        const id = context.newId();
        path(id);
        const row: AttachmentView = {
          id,
          name: input.name,
          mimeType: input.mimeType,
          bytes: input.bytes,
          sha256: input.sha256,
          status: 'uploading',
          error: null,
          truncated: false,
          createdAt: context.now(),
          summary: null,
        };
        db.run(
          `INSERT INTO attachments (id, request_id, owner_id, metadata, text_content)
          VALUES ($id, $requestId, $ownerId, $metadata, NULL)`,
          { id, requestId: input.requestId, ownerId, metadata: JSON.stringify(row) },
        );
        return row;
      });
    },
    requireOwned(id: string, ownerId: string): AttachmentView {
      const row = require(id);
      const owner = db.get('SELECT owner_id FROM attachments WHERE id = $id', { id });
      if (owner?.['owner_id'] !== ownerId) {
        throw new StateError('not_found', '没有找到这份附件。');
      }
      return row;
    },
    storeBytes(id: string, data: Buffer): void {
      const row = require(id);
      if (row.status === 'deleted' || row.status === 'deleting') {
        throw new StateError('invalid_input', '原图已按确认要求删除，不能重新上传到这个标识。');
      }
      if (data.length !== row.bytes || createHash('sha256').update(data).digest('hex') !== row.sha256) {
        throw new StateError('invalid_input', '附件大小或摘要不匹配。');
      }
      const target = path(id);
      ensureDirectory();
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
        chmodSync(temporary, 0o600);
        linkSync(temporary, target);
      } catch (cause) {
        if (!(cause instanceof Error && 'code' in cause && cause.code === 'EEXIST')) {
          throw new StateError('invalid_input', '附件原件没有存好，请用同一标识重试。');
        }
        if (createHash('sha256').update(readFileSync(target)).digest('hex') !== row.sha256) {
          throw new StateError('corrupt_record', '附件原件校验不通过。');
        }
      } finally {
        rmSync(temporary, { force: true });
      }
    },
    finish(id: string, result: { text: string | null; truncated: boolean; error: string | null }): AttachmentView {
      const row = require(id);
      if (row.status === 'ready' || row.status === 'deleted' || row.status === 'deleting') {
        return row;
      }
      return save(
        {
          ...row,
          status: result.error === null ? 'ready' : 'failed',
          error: result.error,
          truncated: result.truncated,
        },
        result.text,
      );
    },
    readBytes(id: string): Buffer {
      const row = require(id);
      if (row.status !== 'ready') {
        throw new StateError('invalid_input', '这份附件原件目前不可读。');
      }
      try {
        const data = readFileSync(path(id));
        if (data.length !== row.bytes || createHash('sha256').update(data).digest('hex') !== row.sha256) {
          throw new Error('checksum');
        }
        return data;
      } catch {
        throw new StateError('corrupt_record', '附件原件缺失或校验失败。');
      }
    },
    text(id: string): string | null {
      const row = require(id);
      if (row.status !== 'ready') {
        return null;
      }
      const value = db.get('SELECT text_content FROM attachments WHERE id = $id', { id })?.['text_content'];
      return typeof value === 'string' ? value : null;
    },
    markForDeletion(id: string, summary: string): void {
      const row = require(id);
      save({ ...row, name: '已记账付款截图', status: 'deleting', summary, error: null }, null);
    },
    purgePending(): number {
      const pending = db
        .all("SELECT metadata FROM attachments WHERE json_extract(metadata, '$.status') = 'deleting'")
        .map(read);
      for (const row of pending) {
        rmSync(path(row.id), { force: true });
        save({ ...row, status: 'deleted' }, null);
      }
      return pending.length;
    },
  };
}
