// 站内信的存取（M5）：信（同一个 Message-ID 只一行，再收一次拿回原来那一条）、回复（action_id 唯一）、收信进度（一行）。
// 已读 / 收藏 / 归档是时间列；归档、删都不删行。哪些算「十个分类」里的哪一类在这里按列筛。

import {
  INBOX_SOURCES,
  InboxMessageInputSchema,
  InboxMessagePatchSchema,
  InboxMessageRefillSchema,
  InboxMessageSchema,
  InboxReplySchema,
  InboxSyncPatchSchema,
  InboxSyncSchema,
  type CreateOptions,
  type InboxMessage,
  type InboxMessageInput,
  type InboxMessageRefill,
  type InboxReply,
  type InboxSource,
  type InboxSync,
  type InboxSyncPatch,
  type Page,
} from '../../shared/state.ts';
import {
  checked,
  definedEntries,
  encodeRow,
  OBJECT_META_COLUMNS,
  readRow,
  sqlColumns,
  type ColumnMap,
} from './codec.ts';
import type { Params } from './db.ts';
import { fromSqliteError, notFound, versionConflict } from './errors.ts';
import { createInboxMailParts } from './inbox-mail-parts.ts';
import { ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const MESSAGE_COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  source: 'text',
  fromAddress: 'text',
  fromName: 'text',
  title: 'text',
  body: 'text',
  receivedAt: 'text',
  act: 'boolean',
  attachments: 'json',
  messageId: 'text',
  toAddress: 'text',
  ref: 'text',
  readAt: 'text',
  starredAt: 'text',
  archivedAt: 'text',
  handledAt: 'text',
  handledNote: 'text',
  // 迁移 0052：邮件按原样显示。
  bodyHtml: 'text',
  rawPath: 'text',
  rawSha256: 'text',
  imapUid: 'integer',
  uidValidity: 'integer',
  mailbox: 'text',
  mimeAt: 'text',
  mimeTriedAt: 'text',
  duplicateOf: 'text',
};

type MessageSpec = StoreSpec<
  typeof InboxMessageSchema,
  typeof InboxMessageInputSchema,
  typeof InboxMessagePatchSchema
>;
const MESSAGE_SPEC: MessageSpec = {
  table: 'inbox_messages',
  schema: InboxMessageSchema,
  input: InboxMessageInputSchema,
  patch: InboxMessagePatchSchema,
  columns: MESSAGE_COLUMNS,
  defaults: {
    fromName: null,
    act: false,
    attachments: [],
    messageId: null,
    toAddress: null,
    ref: null,
    readAt: null,
    starredAt: null,
    archivedAt: null,
    handledAt: null,
    handledNote: null,
    bodyHtml: null,
    rawPath: null,
    rawSha256: null,
    imapUid: null,
    uidValidity: null,
    mailbox: null,
    mimeAt: null,
    mimeTriedAt: null,
    duplicateOf: null,
  },
};

/** mail.refetch 原地补正文用的同一张表（只认 InboxMessageRefillSchema 那几列）。 */
const REFILL_SPEC: StoreSpec<typeof InboxMessageSchema, typeof InboxMessageInputSchema,
  typeof InboxMessageRefillSchema> = { ...MESSAGE_SPEC, patch: InboxMessageRefillSchema };

// 迁移 0052：重复的那一封（duplicate_of 有值）哪里都不显示，行留着。
const SHOWN = 'duplicate_of IS NULL';

const REPLY_COLUMNS: ColumnMap = {
  id: 'text',
  createdAt: 'text',
  updatedAt: 'text',
  version: 'integer',
  messageId: 'text',
  text: 'text',
  status: 'text',
  actionId: 'text',
  deviceId: 'text',
  sentAt: 'text',
  error: 'text',
};

const SYNC_COLUMNS: ColumnMap = {
  id: 'text',
  createdAt: 'text',
  updatedAt: 'text',
  version: 'integer',
  uidValidity: 'integer',
  lastUid: 'integer',
  lastSyncAt: 'text',
  lastCount: 'integer',
  lastError: 'text',
};
const SYNC_ID = 'imap';

/** 十个分类：全部 · 未读 · 六种来源 · 收藏 · 归档。 */
export type InboxBox = 'all' | 'unread' | 'starred' | 'archived' | InboxSource;

export interface InboxFilter {
  box: InboxBox;
  /** 在标题、正文、发件人里找（原样子串，不分词）。 */
  query?: string;
}

function isSource(box: string): box is InboxSource {
  return (INBOX_SOURCES as readonly string[]).includes(box);
}

function whereOf(filter: InboxFilter): { where: string; params: Params } {
  const clauses: string[] = [SHOWN];
  const params: Params = {};
  if (filter.box === 'archived') {
    clauses.push('archived_at IS NOT NULL');
  } else {
    clauses.push('archived_at IS NULL');
  }
  if (filter.box === 'unread') {
    clauses.push('read_at IS NULL');
  } else if (filter.box === 'starred') {
    clauses.push('starred_at IS NOT NULL');
  } else if (isSource(filter.box)) {
    clauses.push('source = $source');
    params['source'] = filter.box;
  }
  const query = filter.query?.trim() ?? '';
  if (query !== '') {
    clauses.push(`(instr(title, $q) > 0 OR instr(body, $q) > 0 OR instr(from_address, $q) > 0
      OR instr(coalesce(from_name, ''), $q) > 0)`);
    params['q'] = query;
  }
  return { where: clauses.join(' AND '), params };
}

const NEWEST_FIRST = 'received_at DESC, id DESC';

export function createInboxStores(context: StoreContext) {
  const messages = new ObjectStore(context, MESSAGE_SPEC);
  const refills = new ObjectStore(context, REFILL_SPEC);
  const replyInsert = (() => {
    const { names, placeholders } = sqlColumns(REPLY_COLUMNS);
    return `INSERT INTO inbox_replies (${names}) VALUES (${placeholders})`;
  })();

  function byMessageId(messageId: string): InboxMessage | undefined {
    return messages.select('message_id = $message_id', { message_id: messageId }, { limit: 1 })[0];
  }

  function readReply(sql: string, params: Params): InboxReply | undefined {
    const row = context.db.get(sql, params);
    return row === undefined ? undefined : readRow(InboxReplySchema, REPLY_COLUMNS, row, 'inbox_replies');
  }

  function readSync(): InboxSync | undefined {
    const row = context.db.get('SELECT * FROM inbox_sync WHERE id = $id', { id: SYNC_ID });
    return row === undefined ? undefined : readRow(InboxSyncSchema, SYNC_COLUMNS, row, 'inbox_sync');
  }

  return {
    inboxMessages: {
      get: messages.get.bind(messages),
      require: messages.require.bind(messages),
      update: messages.update.bind(messages),
      byMessageId,
      /** mail.refetch 从 Gmail 抓回整封以后原地补（版本加 1，行还是那一行）。 */
      refill(id: string, expectedVersion: number, refill: InboxMessageRefill): InboxMessage {
        return refills.update(id, expectedVersion, refill);
      },
      /** 还没按整封 MIME 解析过的邮件：没找过的在前，各自新的在前；收起的重复不算。 */
      needingMime(limit: number): InboxMessage[] {
        return messages.select(`source = 'email' AND mime_at IS NULL AND ${SHOWN}`, {}, { limit },
          `mime_tried_at IS NOT NULL, ${NEWEST_FIRST}`);
      },
      /** 还没补、也还没找过的封数（mail.refetch 报告里「还剩」）。 */
      untriedMime(): number {
        return Number(context.db.get(`SELECT count(*) AS n FROM inbox_messages WHERE source = 'email'
          AND mime_at IS NULL AND mime_tried_at IS NULL AND ${SHOWN}`)?.['n'] ?? 0);
      },
      /** A message with a Message-ID already here comes back as it is (`created: false`). */
      add(input: InboxMessageInput, options: CreateOptions = {}): { message: InboxMessage; created: boolean } {
        return context.db.transaction(() => {
          const existing = input.messageId === undefined || input.messageId === null
            ? undefined
            : byMessageId(input.messageId);
          if (existing !== undefined) {
            return { message: existing, created: false };
          }
          return { message: messages.create(input, undefined, options), created: true };
        });
      },
      page(filter: InboxFilter, page: Page): InboxMessage[] {
        const { where, params } = whereOf(filter);
        return messages.select(where, params, page, NEWEST_FIRST);
      },
      /** 来信条件核对实际发件人；归档不抹掉已收到回信这个事实。 */
      emailFromAfter(sender: string, after: string): InboxMessage | undefined {
        return messages.select(`source = 'email' AND received_at >= $after
          AND (lower(trim(from_address)) = $sender OR lower(trim(coalesce(from_name, ''))) = $sender)`,
        { sender: sender.trim().toLowerCase(), after }, { limit: 1 }, NEWEST_FIRST)[0];
      },
      count(filter: InboxFilter): number {
        const { where, params } = whereOf(filter);
        return Number(context.db.get(`SELECT count(*) AS n FROM inbox_messages WHERE ${where}`, params)?.['n'] ?? 0);
      },
      /**
       * 第 113 条：邮件按发件地址归并成联系人。每个地址一行：最近一封的时间、没读的封数（不算归档的）。
       * 地址比较不分大小写、去掉两头空白（同一个人大小写不一的来信算一个联系人）。
       */
      emailSenders(): { address: string; lastAt: string; unread: number }[] {
        const rows = context.db.all(`SELECT lower(trim(from_address)) AS address, MAX(received_at) AS last_at,
          SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM inbox_messages
          WHERE source = 'email' AND archived_at IS NULL AND ${SHOWN} GROUP BY lower(trim(from_address))`);
        return rows.map((row) => ({ address: String(row['address']), lastAt: String(row['last_at']),
          unread: Number(row['unread'] ?? 0) }));
      },
      /** 一个发件地址（或一种系统来源）没归档的来信，新的在前；`before` 是收到时间（不含）。 */
      thread(filter: { address: string } | { source: InboxSource }, before: string | undefined, limit: number):
        InboxMessage[] {
        const clauses = ['archived_at IS NULL', SHOWN];
        const params: Params = {};
        if ('address' in filter) {
          clauses.push("source = 'email' AND lower(trim(from_address)) = $address");
          params['address'] = filter.address;
        } else {
          clauses.push('source = $source');
          params['source'] = filter.source;
        }
        if (before !== undefined) {
          clauses.push('received_at < $before');
          params['before'] = before;
        }
        return messages.select(clauses.join(' AND '), params, { limit }, NEWEST_FIRST);
      },
      /** 每种来源一行：最近一封的时间、没读的封数（系统联系人用）。 */
      sourceSummaries(): { source: InboxSource; lastAt: string; unread: number }[] {
        const rows = context.db.all(`SELECT source, MAX(received_at) AS last_at,
          SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM inbox_messages
          WHERE archived_at IS NULL AND ${SHOWN} GROUP BY source`);
        return rows.flatMap((row) => {
          const source = String(row['source']);
          return isSource(source) ? [{ source, lastAt: String(row['last_at']), unread: Number(row['unread'] ?? 0) }]
            : [];
        });
      },
      /** Unread, not archived, by source (the bell's number is their sum). */
      unreadBySource(): Record<InboxSource, number> {
        const rows = context.db.all(`SELECT source, count(*) AS n FROM inbox_messages
          WHERE archived_at IS NULL AND read_at IS NULL AND ${SHOWN} GROUP BY source`);
        const counts = Object.fromEntries(INBOX_SOURCES.map((source) => [source, 0])) as Record<InboxSource, number>;
        for (const row of rows) {
          const source = String(row['source']);
          if (isSource(source)) {
            counts[source] = Number(row['n']);
          }
        }
        return counts;
      },
    },
    inboxMailParts: createInboxMailParts(context),
    inboxReplies: {
      byId: (id: string): InboxReply | undefined => readReply('SELECT * FROM inbox_replies WHERE id = $id', { id }),
      byActionId: (actionId: string): InboxReply | undefined =>
        readReply('SELECT * FROM inbox_replies WHERE action_id = $action_id', { action_id: actionId }),
      /** 第 102 条粗筛的确定性事实：用户给这个地址发过信（回复已发出）。 */
      sentTo(address: string): boolean {
        const sql = `SELECT 1 FROM inbox_replies r JOIN inbox_messages m ON m.id = r.message_id
          WHERE m.from_address = $address AND r.sent_at IS NOT NULL LIMIT 1`;
        return context.db.get(sql, { address }) !== undefined;
      },
      forMessage(messageId: string): InboxReply[] {
        const sql = 'SELECT * FROM inbox_replies WHERE message_id = $message_id ORDER BY created_at, id';
        return context.db.all(sql, { message_id: messageId }).map((row) => {
          return readRow(InboxReplySchema, REPLY_COLUMNS, row, 'inbox_replies');
        });
      },
      create(input: Omit<InboxReply, 'id' | 'createdAt' | 'updatedAt' | 'version'>): InboxReply {
        const now = context.now();
        const reply = checked(
          InboxReplySchema,
          { ...input, id: context.newId(), createdAt: now, updatedAt: now, version: 1 },
          'invalid_input',
          '记一条回复',
        );
        try {
          context.db.run(replyInsert, encodeRow(REPLY_COLUMNS, reply));
        } catch (error) {
          throw fromSqliteError(error, '记一条回复');
        }
        return reply;
      },
      update(id: string, expectedVersion: number, patch: Partial<Pick<InboxReply, 'status' | 'sentAt' | 'error'>>) {
        return context.db.transaction(() => {
          const current = readReply('SELECT * FROM inbox_replies WHERE id = $id', { id });
          if (current === undefined) {
            throw notFound('inbox_replies', id);
          }
          if (current.version !== expectedVersion) {
            throw versionConflict('inbox_replies', id, expectedVersion, current.version);
          }
          const next = checked(
            InboxReplySchema,
            { ...current, ...definedEntries(patch), updatedAt: context.now(), version: current.version + 1 },
            'invalid_input',
            '更新回复',
          );
          context.db.run(
            `UPDATE inbox_replies SET status = $status, sent_at = $sent_at, error = $error, updated_at = $updated_at,
              version = $version WHERE id = $id`,
            {
              status: next.status,
              sent_at: next.sentAt,
              error: next.error,
              updated_at: next.updatedAt,
              version: next.version,
              id,
            },
          );
          return next;
        });
      },
    },
    inboxSync: {
      get: readSync,
      /** Records where the IMAP sync got to; the row is made the first time. */
      record(patch: InboxSyncPatch): InboxSync {
        const values = definedEntries(checked(InboxSyncPatchSchema, patch, 'invalid_input', '记收信进度'));
        return context.db.transaction(() => {
          const now = context.now();
          const current = readSync() ?? {
            id: SYNC_ID,
            createdAt: now,
            updatedAt: now,
            version: 0,
            uidValidity: null,
            lastUid: null,
            lastSyncAt: null,
            lastCount: null,
            lastError: null,
          };
          const next = checked(
            InboxSyncSchema,
            { ...current, ...values, updatedAt: now, version: current.version + 1 },
            'invalid_input',
            '记收信进度',
          );
          const params = encodeRow(SYNC_COLUMNS, next);
          if (current.version === 0) {
            const { names, placeholders } = sqlColumns(SYNC_COLUMNS);
            context.db.run(`INSERT INTO inbox_sync (${names}) VALUES (${placeholders})`, params);
          } else {
            const { created_at: _created, ...changed } = params;
            context.db.run(
              `UPDATE inbox_sync SET uid_validity = $uid_validity, last_uid = $last_uid, last_sync_at = $last_sync_at,
                last_count = $last_count, last_error = $last_error, updated_at = $updated_at, version = $version
                WHERE id = $id`,
              changed,
            );
          }
          return next;
        });
      },
    },
  };
}

export type InboxStores = ReturnType<typeof createInboxStores>;
