import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Value } from 'typebox/value';
import { NetworkAttachmentMetaSchema, type NetworkAttachmentMeta, type NetworkAttachmentView,
  type UploadNetworkAttachment } from '../../shared/network-attachments.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';
import type { Row } from './db.ts';

export interface NetworkAttachmentRecord {
  view: NetworkAttachmentView; metadata: NetworkAttachmentMeta; sourceAccountId: string; remoteId: string;
  local: boolean; threadId: string | null; messageId: string | null; group: boolean; recipients: string[];
}
const FIELDS = 'id, remote_id, source_account_id, local_owner, thread_id, contact_message_id, '
  + 'group_message_id, recipients, metadata, text_content, error, content IS NOT NULL AS ready';
const digest = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
const fail = (message: string): never => { throw new StateError('invalid_input', message); };
export function createNetworkAttachmentStore({ db, now, newId }: StoreContext) {
  const read = (row: Row): NetworkAttachmentRecord => {
    const metadata = JSON.parse(String(row['metadata'])) as NetworkAttachmentMeta;
    if (!Value.Check(NetworkAttachmentMetaSchema, metadata)) {
      throw new StateError('corrupt_record', '消息附件信息损坏。');
    }
    const error = typeof row['error'] === 'string' ? row['error'] : null;
    const message = row['contact_message_id'] ?? row['group_message_id'];
    return { metadata, view: { ...metadata, id: String(row['id']),
      status: row['ready'] === 1 ? 'ready' : error === null ? 'pending' : 'failed', error },
    sourceAccountId: String(row['source_account_id']), remoteId: String(row['remote_id']),
    local: row['local_owner'] === 1, threadId: row['thread_id'] === null ? null : String(row['thread_id']),
    messageId: message === null ? null : String(message), group: row['group_message_id'] !== null,
    recipients: JSON.parse(String(row['recipients'])) as string[] };
  };
  const require = (id: string): NetworkAttachmentRecord => {
    const row = db.get(`SELECT ${FIELDS} FROM network_attachments WHERE id = $id`, { id });
    if (row === undefined) throw new StateError('not_found', '没有这份消息附件。');
    return read(row);
  };
  const forMessage = (id: string): NetworkAttachmentView[] => db.all(`SELECT ${FIELDS} FROM network_attachments
    WHERE contact_message_id = $id OR group_message_id = $id ORDER BY rowid`, { id }).map((row) => read(row).view);
  return {
    require, forMessage,
    get(id: string): NetworkAttachmentRecord | undefined {
      const row = db.get(`SELECT ${FIELDS} FROM network_attachments WHERE id=$id`, { id });
      return row === undefined ? undefined : read(row);
    },
    upload(input: UploadNetworkAttachment, sourceAccountId: string, text: string | null): NetworkAttachmentView {
      const data = Buffer.from(input.content, 'base64');
      if (data.length !== input.bytes || digest(data) !== input.sha256) fail('附件大小或摘要不匹配。');
      const old = db.get(`SELECT ${FIELDS} FROM network_attachments WHERE request_id = $id`, { id: input.requestId });
      const { requestId, content: _, ...fields } = input;
      if (old !== undefined) {
        const record = read(old);
        if (record.sourceAccountId !== sourceAccountId || !isDeepStrictEqual(fields,
          Object.fromEntries(Object.entries(record.metadata).filter(([key]) => key !== 'id')))) {
          fail('这个上传标识已经用在另一份附件上。');
        }
        return record.view;
      }
      const metadata = { ...fields, id: newId() };
      if (!Value.Check(NetworkAttachmentMetaSchema, metadata)) fail('消息附件格式不正确。');
      db.run(`INSERT INTO network_attachments (id, request_id, remote_id, source_account_id, local_owner,
        metadata, content, text_content, created_at)
        VALUES ($id,$requestId,$id,$account,1,$metadata,$content,$text,$at)`,
      { id: metadata.id, requestId, account: sourceAccountId, metadata: JSON.stringify(metadata), content: data,
        text, at: now() });
      return require(metadata.id).view;
    },
    outgoing(ids: readonly string[], account: string): NetworkAttachmentMeta[] {
      if (new Set(ids).size !== ids.length || ids.length > 5) fail('一次最多发送五份不同的附件。');
      return ids.map((id) => {
        const row = require(id);
        if (!row.local || row.sourceAccountId !== account || row.view.status !== 'ready') {
          fail('只能发送本人上传且已保存的附件。');
        }
        return row.metadata;
      });
    },
    bind(ids: readonly string[], threadId: string, messageId: string, group: boolean,
      recipients: readonly string[]): void {
      for (const id of ids) {
        const row = require(id);
        if (row.messageId !== null && row.messageId !== messageId) fail('附件已经用于另一条消息，请重新上传。');
        db.run(`UPDATE network_attachments SET thread_id=$thread,
          contact_message_id=$contact, group_message_id=$group, recipients=$recipients WHERE id=$id`,
        { id, thread: threadId, contact: group ? null : messageId, group: group ? messageId : null,
          recipients: JSON.stringify(recipients) });
      }
    },
    receive(meta: readonly NetworkAttachmentMeta[], account: string, threadId: string, messageId: string,
      group: boolean): void {
      for (const item of meta) {
        if (!Value.Check(NetworkAttachmentMetaSchema, item)) fail('收到的消息附件格式不正确。');
        db.run(`INSERT OR IGNORE INTO network_attachments (id,remote_id,source_account_id,local_owner,
          thread_id,contact_message_id,group_message_id,metadata,created_at)
          VALUES ($id,$remote,$account,0,$thread,$contact,$group,$metadata,$at)`,
        { id: newId(), remote: item.id, account, thread: threadId, contact: group ? null : messageId,
          group: group ? messageId : null, metadata: JSON.stringify(item), at: now() });
      }
    },
    bytes(id: string): Buffer | null {
      const row = require(id);
      const value = db.get('SELECT content FROM network_attachments WHERE id=$id', { id })?.['content'];
      if (!(value instanceof Uint8Array)) return null;
      const data = Buffer.from(value);
      if (data.length !== row.metadata.bytes || digest(data) !== row.metadata.sha256) {
        throw new StateError('corrupt_record', '消息附件原件校验失败。');
      }
      return data;
    },
    finish(id: string, data: Buffer, text: string | null): void {
      const row = require(id);
      if (data.length !== row.metadata.bytes || digest(data) !== row.metadata.sha256) fail('原件大小或摘要不匹配。');
      db.run('UPDATE network_attachments SET content=$content,text_content=$text,error=NULL WHERE id=$id',
        { id, content: data, text });
    },
    failed(id: string, error: string): void {
      require(id);
      db.run('UPDATE network_attachments SET error=$error WHERE id=$id AND content IS NULL', { id, error });
    },
    contextText(messageId: string): string {
      return db.all(`SELECT ${FIELDS} FROM network_attachments WHERE contact_message_id=$id OR group_message_id=$id`,
        { id: messageId }).map((raw) => {
        const row = read(raw);
        const text = typeof raw['text_content'] === 'string' ? raw['text_content'] : null;
        const detail = text ?? (row.metadata.mimeType.startsWith('image/')
          ? row.view.status !== 'ready' ? '图片原件尚未取得。'
            : row.metadata.bytes > 5 * 1024 * 1024 ? '图片大于 5 MB，未提供给模型。' : '图片附件。'
          : '没有可读取的文本。');
        return `附件「${row.metadata.name}」（${row.metadata.mimeType}）：${detail}`;
      }).join('\n').slice(0, 30_000);
    },
  };
}
