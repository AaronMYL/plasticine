// 联系人的信（第 113 条，迁移 0045）：进来的（已验签、已解密）和出去的。出去的那几行同时是发件箱：network/ 按
// status = sending 和 next_attempt_at 取出来发，成功记 sent，重试用完记 failed。envelope_id 唯一：同一封信进来两次
// 只记一行；request_id 唯一：界面重发同一句不发第二封。

import {
  ContactMessageInputSchema,
  ContactMessagePatchSchema,
  ContactMessageSchema,
  type ContactMessage,
  type ContactMessageInput,
  type ContactMessagePatch,
} from '../../shared/state.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  contactId: 'text',
  direction: 'text',
  author: 'text',
  kind: 'text',
  text: 'text',
  payload: 'json',
  exchangeId: 'text',
  taskId: 'text',
  sentAt: 'text',
  status: 'text',
  envelopeId: 'text',
  requestId: 'text',
  readAt: 'text',
  attempts: 'integer',
  nextAttemptAt: 'text',
  error: 'text',
  groupId: 'text',
};

const SPEC: StoreSpec<typeof ContactMessageSchema, typeof ContactMessageInputSchema,
  typeof ContactMessagePatchSchema> = {
  table: 'contact_messages',
  schema: ContactMessageSchema,
  input: ContactMessageInputSchema,
  patch: ContactMessagePatchSchema,
  columns: COLUMNS,
  defaults: { exchangeId: null, taskId: null, envelopeId: null, requestId: null, readAt: null, attempts: 0,
    nextAttemptAt: null, error: null, groupId: null },
};

// 「已读到哪」、资料（头像）、群的发件箱和群里的往来、认领、撤回这类信不进一对一的聊天、不算未读（群里的画在群里）。
const VISIBLE = `kind NOT IN ('read', 'profile', 'group_update', 'group_message', 'group_task', 'task_claim',
  'task_cancel', 'reaction') AND group_id IS NULL`;
const NEWEST_FIRST = 'sent_at DESC, created_at DESC, id DESC';

export function createContactMessageStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);
  const one = (where: string, params: Record<string, string>): ContactMessage | undefined =>
    store.select(where, params, { limit: 1 })[0];
  return {
    get: store.get.bind(store),
    require: store.require.bind(store),
    create: (input: ContactMessageInput): ContactMessage => store.create(input),
    update: (id: string, version: number, patch: ContactMessagePatch): ContactMessage =>
      store.update(id, version, patch),
    forGroupMessage: (groupId: string, messageId: string): ContactMessage[] => store.select(
      "group_id=$groupId AND kind='group_message' AND direction='out' "
        + "AND json_extract(payload,'$.messageId')=$messageId",
      { groupId, messageId }),
    byEnvelope: (envelopeId: string) => one('envelope_id = $envelope_id', { envelope_id: envelopeId }),
    /** 一对一聊天里最近 500 封表情信（第 12 批），先来的在前。 */
    reactions: (contactId: string): ContactMessage[] => store.select(
      "contact_id = $contact_id AND kind = 'reaction' AND group_id IS NULL", { contact_id: contactId },
      { limit: 500 }, NEWEST_FIRST).reverse(),
    /** 群里的表情信，先来的在前。 */
    groupReactions: (groupId: string): ContactMessage[] => store.select(
      "group_id = $group_id AND kind = 'reaction'", { group_id: groupId }, { limit: 500 },
      NEWEST_FIRST).reverse(),
    byRequest: (requestId: string) => one('request_id = $request_id', { request_id: requestId }),
    /** 一页，最新的在前；`before` 是 sent_at（不含）。 */
    page(contactId: string, before: string | undefined, limit: number): ContactMessage[] {
      const where = before === undefined
        ? `contact_id = $contact_id AND ${VISIBLE}`
        : `contact_id = $contact_id AND ${VISIBLE} AND sent_at < $before`;
      const params = before === undefined ? { contact_id: contactId } : { contact_id: contactId, before };
      return store.select(where, params, { limit }, NEWEST_FIRST);
    },
    latest: (contactId: string): ContactMessage | undefined =>
      store.select(`contact_id = $contact_id AND ${VISIBLE}`, { contact_id: contactId }, { limit: 1 },
        NEWEST_FIRST)[0],
    unreadCount(contactId: string): number {
      const row = context.db.get(`SELECT COUNT(*) AS n FROM contact_messages WHERE contact_id = $contact_id
        AND direction = 'in' AND read_at IS NULL AND ${VISIBLE}`, { contact_id: contactId });
      return Number(row?.['n'] ?? 0);
    },
    /** 进来的、`upTo` 以前（含）的标已读；返回标了几条。 */
    markRead(contactId: string, upTo: string, at: string): number {
      return context.db.run(`UPDATE contact_messages SET read_at = $at, updated_at = $at, version = version + 1
        WHERE contact_id = $contact_id AND direction = 'in' AND read_at IS NULL AND sent_at <= $up_to`,
      { contact_id: contactId, up_to: upTo, at });
    },
    /** 到了该发（或该重试）的时候的发件箱，先写的先发。 */
    outboxDue(now: string, limit: number): ContactMessage[] {
      return store.select(`direction = 'out' AND status = 'sending'
        AND (next_attempt_at IS NULL OR next_attempt_at <= $now)`, { now }, { limit }, 'created_at, id');
    },
    /** 下一封要重试的什么时候到（发件箱空了是 undefined）。 */
    nextAttemptAt(): string | undefined {
      const row = context.db.get(`SELECT MIN(COALESCE(next_attempt_at, created_at)) AS at FROM contact_messages
        WHERE direction = 'out' AND status = 'sending'`);
      const at = row?.['at'];
      return typeof at === 'string' ? at : undefined;
    },
    forExchange: (contactId: string, exchangeId: string): ContactMessage[] => allPages((page) =>
      store.select('contact_id = $contact_id AND exchange_id = $exchange_id',
        { contact_id: contactId, exchange_id: exchangeId }, page, 'sent_at, created_at, id')),
    forTask: (taskId: string): ContactMessage[] => allPages((page) =>
      store.select('task_id = $task_id', { task_id: taskId }, page, 'sent_at, created_at, id')),
    /**
     * 进来的、问我的 Plasticine 的、`since` 以后还没处理的（分身既没直接回、也没说「我问一下主人」）：重启后接着答。
     * 处理过的那封回信 request_id 是 proxy:<问题 id> 或 proxy-hold:<问题 id>（network/proxy.ts）。
     */
    unansweredAsks(since: string): ContactMessage[] {
      return store.select(`direction = 'in' AND kind = 'ask_ai' AND sent_at >= $since AND NOT EXISTS (
        SELECT 1 FROM contact_messages r WHERE r.request_id IN ('proxy:' || contact_messages.id,
          'proxy-hold:' || contact_messages.id))`, { since }, { limit: 100 }, 'sent_at, id');
    },
    /** 这段对话最近的几句（分身的上下文），旧的在前。 */
    recent(contactId: string, limit: number): ContactMessage[] {
      return store.select(`contact_id = $contact_id AND kind IN ('hello', 'text', 'ai_text', 'ask_ai')`,
        { contact_id: contactId }, { limit }, NEWEST_FIRST).reverse();
    },
  };
}

export type ContactMessageStore = ReturnType<typeof createContactMessageStore>;
