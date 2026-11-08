// 跨用户任务、材料的档位、分身说过的话（第 113 条，迁移 0045）。任务的 id 就是两端共用的 taskId（发起方生成）；
// 档位一种材料一行（没有行 = 私密）；said_log 只追加，不改。

import {
  NetworkTaskInputSchema,
  NetworkTaskPatchSchema,
  NetworkTaskSchema,
  SaidLogInputSchema,
  SaidLogSchema,
  VisibilityMarkSchema,
  type NetworkTask,
  type NetworkTaskInput,
  type NetworkTaskPatch,
  type SaidLog,
  type SaidLogInput,
  type VisibilityMark,
} from '../../shared/state.ts';
import type { MaterialKind, Tier } from '../../shared/api/visibility.ts';
import { checked, encodeRow, readRow, RECORD_META_COLUMNS, sqlColumns, type ColumnMap } from './codec.ts';
import { fromSqliteError, versionConflict } from './errors.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const TASK_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  direction: 'text',
  contactId: 'text',
  title: 'text',
  goal: 'text',
  acceptance: 'text',
  deadline: 'text',
  attachment: 'text',
  state: 'text',
  offeredAt: 'text',
  requestId: 'text',
  doer: 'text',
  localTaskId: 'text',
  askId: 'text',
  decidedAt: 'text',
  deliveryText: 'text',
  deliveryAt: 'text',
  verdict: 'text',
  verdictNote: 'text',
  verdictAt: 'text',
  groupId: 'text',
};

const TASK_SPEC: StoreSpec<typeof NetworkTaskSchema, typeof NetworkTaskInputSchema, typeof NetworkTaskPatchSchema> = {
  table: 'network_tasks',
  schema: NetworkTaskSchema,
  input: NetworkTaskInputSchema,
  patch: NetworkTaskPatchSchema,
  columns: TASK_COLUMNS,
  defaults: { deadline: null, attachment: null, requestId: null, doer: null, localTaskId: null, askId: null,
    decidedAt: null, deliveryText: null, deliveryAt: null, verdict: null, verdictNote: null, verdictAt: null,
    groupId: null },
};

const MARK_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  objectKind: 'text',
  objectId: 'text',
  tier: 'text',
  proposed: 'text',
  confirmedAt: 'text',
};

const SAID_COLUMNS: ColumnMap = {
  id: 'text',
  contactId: 'text',
  text: 'text',
  materials: 'json',
  exchangeId: 'text',
  messageId: 'text',
  at: 'text',
};

function markId(kind: MaterialKind, objectId: string): string {
  return `${kind}:${objectId}`;
}

function createMarkStore(context: StoreContext) {
  const read = (sql: string, params: Record<string, string>): VisibilityMark[] =>
    context.db.all(sql, params).map((row) => readRow(VisibilityMarkSchema, MARK_COLUMNS, row, 'visibility_marks'));
  const get = (kind: MaterialKind, objectId: string): VisibilityMark | undefined =>
    read('SELECT * FROM visibility_marks WHERE id = $id', { id: markId(kind, objectId) })[0];
  /**
   * 写一条档位（没有就建）。`expected` 是界面带来的 version，0 表示「还没有这一行」；对不上就是冲突。
   * `confirmed` 为 false 只记建议（proposed），tier 保持原样（没有行时是 private）。
   */
  function put(kind: MaterialKind, objectId: string, expected: number,
    change: { tier?: Tier; proposed: Tier | null; confirmed: boolean }): VisibilityMark {
    return context.db.transaction(() => {
      const current = get(kind, objectId);
      const version = current?.version ?? 0;
      if (version !== expected) {
        throw versionConflict('visibility_marks', markId(kind, objectId), expected, version);
      }
      const now = context.now();
      const next = checked(VisibilityMarkSchema, {
        id: markId(kind, objectId),
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        version: version + 1,
        objectKind: kind,
        objectId,
        tier: change.tier ?? current?.tier ?? 'private',
        proposed: change.proposed,
        confirmedAt: change.confirmed ? now : current?.confirmedAt ?? null,
      }, 'invalid_input', '写 visibility_marks');
      const params = encodeRow(MARK_COLUMNS, next);
      try {
        if (current === undefined) {
          const { names, placeholders } = sqlColumns(MARK_COLUMNS);
          context.db.run(`INSERT INTO visibility_marks (${names}) VALUES (${placeholders})`, params);
        } else {
          context.db.run(`UPDATE visibility_marks SET tier = $tier, proposed = $proposed, confirmed_at = $confirmed_at,
            updated_at = $updated_at, version = $version WHERE id = $id`, {
            tier: params['tier'] ?? null, proposed: params['proposed'] ?? null,
            confirmed_at: params['confirmed_at'] ?? null, updated_at: params['updated_at'] ?? null,
            version: params['version'] ?? null, id: params['id'] ?? null });
        }
      } catch (error) {
        throw fromSqliteError(error, '写 visibility_marks');
      }
      // 档位变了，索引里这样材料的记录跟着改（别人的 AI 按档位搜）。
      context.index?.materialChanged(kind, objectId);
      return next;
    });
  }
  return {
    get,
    put,
    all: (): VisibilityMark[] => read('SELECT * FROM visibility_marks ORDER BY created_at, id', {}),
  };
}

function createSaidLog(context: StoreContext) {
  const { names, placeholders } = sqlColumns(SAID_COLUMNS);
  return {
    add(input: SaidLogInput): SaidLog {
      const values = checked(SaidLogInputSchema, input, 'invalid_input', '写 said_log');
      const entry = { ...values, id: context.newId(), at: context.now() };
      try {
        context.db.run(`INSERT INTO said_log (${names}) VALUES (${placeholders})`, encodeRow(SAID_COLUMNS, entry));
      } catch (error) {
        throw fromSqliteError(error, '写 said_log');
      }
      return checked(SaidLogSchema, entry, 'corrupt_record', 'said_log 写入的一行');
    },
    /** 最近的在前。 */
    recent(contactId: string, limit: number): SaidLog[] {
      const sql = 'SELECT * FROM said_log WHERE contact_id = $contact_id ORDER BY at DESC, id DESC LIMIT $limit';
      return context.db.all(sql, { contact_id: contactId, limit })
        .map((row) => readRow(SaidLogSchema, SAID_COLUMNS, row, 'said_log'));
    },
  };
}

export function createNetworkTaskStores(context: StoreContext) {
  const tasks = new ObjectStore(context, TASK_SPEC);
  return {
    networkTasks: {
      get: tasks.get.bind(tasks),
      require: tasks.require.bind(tasks),
      /** 任务 id 是两端共用的 taskId。 */
      create: (id: string, input: NetworkTaskInput): NetworkTask => tasks.create(input, undefined, { id }),
      update: (id: string, version: number, patch: NetworkTaskPatch): NetworkTask => tasks.update(id, version, patch),
      byRequest: (requestId: string): NetworkTask | undefined =>
        tasks.select('request_id = $request_id', { request_id: requestId }, { limit: 1 })[0],
      byLocalTask: (taskId: string): NetworkTask | undefined =>
        tasks.select('local_task_id = $task_id', { task_id: taskId }, { limit: 1 })[0],
      /** 和这个人的全部任务（群里接下的不算，那些画在群里），最近发出的在前。 */
      forContact: (contactId: string): NetworkTask[] => allPages((page) =>
        tasks.select('contact_id = $contact_id AND group_id IS NULL', { contact_id: contactId }, page,
          'offered_at DESC, id')),
      /** 交给本机 Plasticine 做、还没交回去的（任务做完后补发交付用）。 */
      awaitingLocal: (): NetworkTask[] => allPages((page) => tasks.select(`direction = 'in' AND doer = 'ai'
        AND local_task_id IS NOT NULL AND state IN ('accepted', 'in_progress')`, {}, page)),
    },
    visibilityMarks: createMarkStore(context),
    saidLog: createSaidLog(context),
  };
}

export type NetworkTaskStores = ReturnType<typeof createNetworkTaskStores>;
