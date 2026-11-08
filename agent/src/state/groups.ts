// 群聊、群里的任务卡、替人答的线（迁移 0064）。只存取：谁能进群、谁先接到任务由 network/ 决定。
// 成员表没有自己的 id（群 id + 账号 id 就是身份），position 记进群先后，拼群头像取前 9 个。

import {
  GroupInputSchema,
  GroupMessageInputSchema,
  GroupMessagePatchSchema,
  GroupMessageSchema,
  GroupPatchSchema,
  GroupSchema,
  GroupTaskInputSchema,
  GroupTaskPatchSchema,
  GroupTaskSchema,
  NetResponseInputSchema,
  NetResponsePatchSchema,
  NetResponseSchema,
  type Group,
  type GroupInput,
  type GroupMember,
  type GroupMessage,
  type GroupMessageInput,
  type GroupPatch,
  type GroupTask,
  type GroupTaskInput,
  type GroupTaskPatch,
  type NetResponse,
  type NetResponseInput,
} from '../../shared/state.ts';
import type { Row } from './db.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const GROUP_SPEC: StoreSpec<typeof GroupSchema, typeof GroupInputSchema, typeof GroupPatchSchema> = {
  table: 'net_groups',
  schema: GroupSchema,
  input: GroupInputSchema,
  patch: GroupPatchSchema,
  columns: { ...RECORD_META_COLUMNS, ownerAccountId: 'text', name: 'text', avatar: 'text', leftAt: 'text',
    lastAt: 'text' },
  defaults: { avatar: null, leftAt: null },
};

const MESSAGE_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  groupId: 'text',
  messageId: 'text',
  authorAccountId: 'text',
  author: 'text',
  kind: 'text',
  text: 'text',
  targetAccountId: 'text',
  exchangeId: 'text',
  taskId: 'text',
  sentAt: 'text',
  requestId: 'text',
  readAt: 'text',
};

const MESSAGE_SPEC: StoreSpec<typeof GroupMessageSchema, typeof GroupMessageInputSchema,
  typeof GroupMessagePatchSchema> = {
  table: 'group_messages',
  schema: GroupMessageSchema,
  input: GroupMessageInputSchema,
  patch: GroupMessagePatchSchema,
  columns: MESSAGE_COLUMNS,
  defaults: { targetAccountId: null, exchangeId: null, taskId: null, requestId: null, readAt: null },
};

const TASK_SPEC: StoreSpec<typeof GroupTaskSchema, typeof GroupTaskInputSchema, typeof GroupTaskPatchSchema> = {
  table: 'group_tasks',
  schema: GroupTaskSchema,
  input: GroupTaskInputSchema,
  patch: GroupTaskPatchSchema,
  columns: { ...RECORD_META_COLUMNS, groupId: 'text', ownerAccountId: 'text', assigneeAccountId: 'text',
    claimerAccountId: 'text', doer: 'text', title: 'text', goal: 'text', deadline: 'text', attachment: 'text',
    state: 'text', claimedAt: 'text', offeredAt: 'text', requestId: 'text' },
  defaults: { deadline: null, attachment: null, requestId: null, claimerAccountId: null, doer: null,
    claimedAt: null },
};

const RESPONSE_SPEC: StoreSpec<typeof NetResponseSchema, typeof NetResponseInputSchema,
  typeof NetResponsePatchSchema> = {
  table: 'net_responses',
  schema: NetResponseSchema,
  input: NetResponseInputSchema,
  patch: NetResponsePatchSchema,
  columns: { ...RECORD_META_COLUMNS, lineId: 'text', origin: 'text', mode: 'text', contactId: 'text',
    groupId: 'text', questionId: 'text', exchangeId: 'text', askerIsAi: 'boolean', materials: 'json',
    status: 'text', settledAt: 'text' },
  defaults: { settledAt: null },
};

// 群里的一句不算未读：本机说明、自己说的、自己的 AI 说的。
const UNREAD = "author NOT IN ('me', 'my_ai', 'system') AND read_at IS NULL";
const NEWEST_FIRST = 'sent_at DESC, created_at DESC, id DESC';

function memberOf(row: Row): GroupMember {
  const left = row['left_at'];
  return {
    groupId: String(row['group_id']),
    accountId: String(row['account_id']),
    handle: String(row['handle']),
    displayName: String(row['display_name']),
    position: Number(row['position']),
    joinedAt: String(row['joined_at']),
    leftAt: left === null || left === undefined ? null : String(left),
  };
}

export interface MemberInput {
  accountId: string;
  handle: string;
  displayName: string;
}

function createMemberTable(context: StoreContext) {
  const { db } = context;
  const list = (groupId: string, withLeft: boolean): GroupMember[] => db.all(`SELECT * FROM net_group_members
    WHERE group_id = $group_id ${withLeft ? '' : 'AND left_at IS NULL'} ORDER BY position, account_id`,
  { group_id: groupId }).map(memberOf);
  return {
    /** 在群里的（退了的不算），进群先后排。 */
    current: (groupId: string): GroupMember[] => list(groupId, false),
    all: (groupId: string): GroupMember[] => list(groupId, true),
    get(groupId: string, accountId: string): GroupMember | undefined {
      const row = db.get('SELECT * FROM net_group_members WHERE group_id = $group_id AND account_id = $account_id',
        { group_id: groupId, account_id: accountId });
      return row === undefined ? undefined : memberOf(row);
    },
    /** 进群（退过的再进来清掉退出时间）；名字跟着最新的。返回是不是新进来的。 */
    upsert(groupId: string, member: MemberInput): boolean {
      const at = context.now();
      const existing = this.get(groupId, member.accountId);
      if (existing !== undefined) {
        db.run(`UPDATE net_group_members SET handle = $handle, display_name = $name, left_at = NULL
          WHERE group_id = $group_id AND account_id = $account_id`, { group_id: groupId,
          account_id: member.accountId, handle: member.handle, name: member.displayName });
        return existing.leftAt !== null;
      }
      const next = db.get('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM net_group_members WHERE group_id = $g',
        { g: groupId });
      db.run(`INSERT INTO net_group_members (group_id, account_id, handle, display_name, position, joined_at)
        VALUES ($group_id, $account_id, $handle, $name, $position, $at)`, { group_id: groupId,
        account_id: member.accountId, handle: member.handle, name: member.displayName,
        position: Number(next?.['n'] ?? 1), at });
      return true;
    },
    leave(groupId: string, accountId: string): void {
      db.run(`UPDATE net_group_members SET left_at = $at WHERE group_id = $group_id AND account_id = $account_id
        AND left_at IS NULL`, { group_id: groupId, account_id: accountId, at: context.now() });
    },
    /** 这个账号在哪些群里（算群里最低档、收信时认人）。 */
    groupsOf: (accountId: string): string[] => db.all(`SELECT group_id FROM net_group_members
      WHERE account_id = $account_id AND left_at IS NULL`, { account_id: accountId })
      .map((row) => String(row['group_id'])),
  };
}

export function createGroupStores(context: StoreContext) {
  const groups = new ObjectStore(context, GROUP_SPEC);
  const messages = new ObjectStore(context, MESSAGE_SPEC);
  const tasks = new ObjectStore(context, TASK_SPEC);
  const responses = new ObjectStore(context, RESPONSE_SPEC);
  return {
    groups: {
      get: groups.get.bind(groups),
      require: groups.require.bind(groups),
      /** 群 id 是建群的人生成、大家共用的。 */
      create: (id: string, input: GroupInput): Group => groups.create(input, undefined, { id }),
      update: (id: string, version: number, patch: GroupPatch): Group => groups.update(id, version, patch),
      /** 还在里面的群，最近有动静的在前。 */
      active: (): Group[] => allPages((page) => groups.select('left_at IS NULL', {}, page, 'last_at DESC, id')),
      all: (): Group[] => allPages((page) => groups.select('1 = 1', {}, page, 'last_at DESC, id')),
    },
    groupMembers: createMemberTable(context),
    groupMessages: {
      get: messages.get.bind(messages),
      create: (input: GroupMessageInput): GroupMessage => messages.create(input),
      byMessageId: (groupId: string, messageId: string): GroupMessage | undefined => messages.select(
        'group_id = $group_id AND message_id = $message_id', { group_id: groupId, message_id: messageId },
        { limit: 1 })[0],
      byRequest: (requestId: string): GroupMessage | undefined =>
        messages.select('request_id = $request_id', { request_id: requestId }, { limit: 1 })[0],
      page(groupId: string, before: string | undefined, limit: number): GroupMessage[] {
        const where = before === undefined ? 'group_id = $group_id' : 'group_id = $group_id AND sent_at < $before';
        const params = before === undefined ? { group_id: groupId } : { group_id: groupId, before };
        return messages.select(where, params, { limit }, NEWEST_FIRST);
      },
      latest: (groupId: string): GroupMessage | undefined => messages.select(
        "group_id = $group_id AND kind <> 'system'", { group_id: groupId }, { limit: 1 }, NEWEST_FIRST)[0],
      /** 最近几句（替人答的线的上下文），旧的在前。 */
      recent: (groupId: string, limit: number): GroupMessage[] => messages.select(
        "group_id = $group_id AND kind IN ('text', 'ask_ai', 'ai_text')", { group_id: groupId }, { limit },
        NEWEST_FIRST).reverse(),
      forExchange: (groupId: string, exchangeId: string): GroupMessage[] => allPages((page) => messages.select(
        'group_id = $group_id AND exchange_id = $exchange_id', { group_id: groupId, exchange_id: exchangeId }, page,
        'sent_at, created_at, id')),
      unreadCount(groupId: string): number {
        const row = context.db.get(`SELECT COUNT(*) AS n FROM group_messages WHERE group_id = $group_id AND ${UNREAD}`,
          { group_id: groupId });
        return Number(row?.['n'] ?? 0);
      },
      markRead(groupId: string, upTo: string, at: string): number {
        return context.db.run(`UPDATE group_messages SET read_at = $at, updated_at = $at, version = version + 1
          WHERE group_id = $group_id AND ${UNREAD} AND sent_at <= $up_to`, { group_id: groupId, up_to: upTo, at });
      },
    },
    groupTasks: {
      get: tasks.get.bind(tasks),
      require: tasks.require.bind(tasks),
      /** 任务 id 是发起人生成、群里共用的。 */
      create: (id: string, input: GroupTaskInput): GroupTask => tasks.create(input, undefined, { id }),
      update: (id: string, version: number, patch: GroupTaskPatch): GroupTask => tasks.update(id, version, patch),
      byRequest: (requestId: string): GroupTask | undefined =>
        tasks.select('request_id = $request_id', { request_id: requestId }, { limit: 1 })[0],
      forGroup: (groupId: string): GroupTask[] => allPages((page) => tasks.select('group_id = $group_id',
        { group_id: groupId }, page, 'offered_at DESC, id')),
    },
    netResponses: {
      get: responses.get.bind(responses),
      create: (input: NetResponseInput): NetResponse => responses.create(input),
      byLine: (lineId: string): NetResponse | undefined =>
        responses.select('line_id = $line_id', { line_id: lineId }, { limit: 1 })[0],
      byQuestion: (questionId: string): NetResponse | undefined =>
        responses.select('question_id = $question_id', { question_id: questionId }, { limit: 1 })[0],
      running: (): NetResponse[] => allPages((page) => responses.select("status = 'running'", {}, page,
        'created_at, id')),
      settle: (id: string, version: number, at: string): NetResponse =>
        responses.update(id, version, { status: 'settled', settledAt: at }),
    },
  };
}

export type GroupStores = ReturnType<typeof createGroupStores>;
