import type { Row } from './db.ts';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { FeedCommentSchema, type FeedComment } from '../../shared/feed-comments.ts';
import type { FeedItem, LegacyRow } from '../../shared/state.ts';
import { readRow, type ColumnMap } from './codec.ts';
import type { StoreContext } from './object-store.ts';

// 旧版信息流条目里带的评论（迁移来的 legacy_payload）；导入器 2026-11-05 随切换脚本删掉，形状留在这里照旧读。
const OldFeedCommentSchema = Type.Object({
  id: Type.String(), by: Type.Enum(['user', 'ai']), text: Type.String(), at: Type.String(),
  pending: Type.Optional(Type.Boolean()),
});
const COLUMNS: ColumnMap = { id: 'text', itemId: 'text', author: 'text', text: 'text', createdAt: 'text',
  replyTo: 'text', status: 'text', error: 'text', version: 'integer' };
const StoredSchema = Type.Omit(FeedCommentSchema, ['migrated']);
const LegacySchema = Type.Object({ row: Type.Object({ comments: Type.Optional(Type.Array(OldFeedCommentSchema)) }) });

function legacyComments(item: FeedItem, archives: LegacyRow[]): FeedComment[] {
  const comments = new Map<string, FeedComment>();
  for (const payload of [item.legacyPayload, ...archives.map((row) => row.payload)]) {
    if (!Value.Check(LegacySchema, payload)) { continue; }
    for (const comment of payload.row.comments ?? []) {
      const id = `legacy:${item.id}:${comment.id}`;
      const existing = comments.get(id);
      if (existing !== undefined && existing.status === 'completed') { continue; }
      const at = new Date(comment.at);
      comments.set(id, { id, itemId: item.id, author: comment.by, text: comment.text,
        createdAt: Number.isFinite(at.getTime()) ? at.toISOString() : item.arrivedAt,
        replyTo: null, status: comment.pending ? 'failed' : 'completed', migrated: true, version: 1,
        error: comment.pending ? '旧版这次回复未完成，原记录保留。' : null });
    }
  }
  if (comments.size === 0 && item.note !== null) {
    comments.set(`legacy:${item.id}:note`, { id: `legacy:${item.id}:note`, itemId: item.id,
      author: 'user', text: item.note, createdAt: item.arrivedAt, replyTo: null, status: 'completed',
      error: null, migrated: true, version: 1 });
  }
  return [...comments.values()];
}

export function createFeedCommentStore(context: StoreContext) {
  const decode = (row: Row): FeedComment =>
    ({ ...readRow(StoredSchema, COLUMNS, row, 'feed_comments'), migrated: false });
  const get = (id: string): FeedComment | undefined => {
    const row = context.db.get('SELECT * FROM feed_comments WHERE id = $id', { id });
    return row === undefined ? undefined : decode(row);
  };
  return {
    get,
    list(item: FeedItem, archives: LegacyRow[]): FeedComment[] {
      const fresh = context.db.all('SELECT * FROM feed_comments WHERE item_id = $id ORDER BY created_at, rowid',
        { id: item.id }).map(decode);
      return [...legacyComments(item, archives), ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    add(itemId: string, requestId: string, text: string): FeedComment {
      const id = `feed-comment:${requestId}`;
      return context.db.transaction(() => {
        const existing = get(id);
        if (existing !== undefined) { return existing; }
        context.db.run(`INSERT INTO feed_comments (id, item_id, author, text, created_at, reply_to, status)
          VALUES ($id, $item, 'user', $text, $at, NULL, 'completed')`,
        { id, item: itemId, text, at: context.now() });
        context.db.run(`INSERT INTO feed_comments (id, item_id, author, text, created_at, reply_to, status)
          VALUES ($id, $item, 'ai', '', $at, $parent, 'pending')`,
        { id: `${id}:reply`, item: itemId, at: context.now(), parent: id });
        return get(id)!;
      });
    },
    next(): FeedComment | undefined {
      const row = context.db.get("SELECT * FROM feed_comments WHERE status = 'pending' ORDER BY rowid LIMIT 1");
      return row === undefined ? undefined : decode(row);
    },
    finish(id: string, text: string, error: string | null): void {
      context.db.run(`UPDATE feed_comments SET status = $status, text = $text, error = $error, version = version + 1
        WHERE id = $id`, { id, text, error, status: error === null ? 'completed' : 'failed' });
    },
    notice(id: string, error: string): void {
      context.db.run(`UPDATE feed_comments
        SET error = CASE WHEN error IS NULL THEN $error ELSE error || char(10) || $error END,
        version = version + 1 WHERE id = $id`, { id, error });
    },
    retry(id: string): void {
      context.db.run(`UPDATE feed_comments SET status = 'pending', error = NULL, version = version + 1
        WHERE id = $id AND status = 'failed'`,
        { id });
    },
  };
}
