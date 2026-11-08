import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { AttachmentViewSchema, type AttachmentView } from '../../shared/attachments.ts';
import type { UploadAttachmentMeta } from '../../shared/api/attachments.ts';
import { checked, readRow } from './codec.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';
import type { Row } from './db.ts';

const Wrapped = Type.Object({ metadata: AttachmentViewSchema });

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
      return db.transaction(() => db
        .all("SELECT metadata FROM attachments WHERE json_extract(metadata, '$.status') = 'uploading'")
        .map(read)
        .map((row) => save({ ...row, status: 'failed',
          error: '附件上传被重启中断，请重新上传或移除待发引用。' }, null)));
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
      mkdirSync(directory ?? '', { recursive: true, mode: 0o700 });
      chmodSync(directory ?? '', 0o700);
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
