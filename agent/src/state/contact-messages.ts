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
    reactions: (contactId: string): ContactMessage[] => store.select(
      "contact_id = $contact_id AND kind = 'reaction' AND group_id IS NULL", { contact_id: contactId },
      { limit: 500 }, NEWEST_FIRST).reverse(),
    groupReactions: (groupId: string): ContactMessage[] => store.select(
      "group_id = $group_id AND kind = 'reaction'", { group_id: groupId }, { limit: 500 },
      NEWEST_FIRST).reverse(),
    byRequest: (requestId: string) => one('request_id = $request_id', { request_id: requestId }),
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
    markRead(contactId: string, upTo: string, at: string): number {
      return context.db.run(`UPDATE contact_messages SET read_at = $at, updated_at = $at, version = version + 1
        WHERE contact_id = $contact_id AND direction = 'in' AND read_at IS NULL AND sent_at <= $up_to`,
      { contact_id: contactId, up_to: upTo, at });
    },
    outboxDue(now: string, limit: number): ContactMessage[] {
      return store.select(`direction = 'out' AND status = 'sending'
        AND (next_attempt_at IS NULL OR next_attempt_at <= $now)`, { now }, { limit }, 'created_at, id');
    },
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
    unansweredAsks(since: string): ContactMessage[] {
      return store.select(`direction = 'in' AND kind = 'ask_ai' AND sent_at >= $since AND NOT EXISTS (
        SELECT 1 FROM contact_messages r WHERE r.request_id IN ('proxy:' || contact_messages.id,
          'proxy-hold:' || contact_messages.id))`, { since }, { limit: 100 }, 'sent_at, id');
    },
    recent(contactId: string, limit: number): ContactMessage[] {
      return store.select(`contact_id = $contact_id AND kind IN ('hello', 'text', 'ai_text', 'ask_ai')`,
        { contact_id: contactId }, { limit }, NEWEST_FIRST).reverse();
    },
  };
}

export type ContactMessageStore = ReturnType<typeof createContactMessageStore>;
