// 新内核的线、线里的消息、排队的消息（迁移 0058）。只存取，不做判断：什么时候开一轮、排队怎么发由 lines/ 决定。
// 消息的 seq 在线内从 1 递增，追加和取最大值在同一个事务里，所以同一条线并发写也不会撞号。

import { Value } from 'typebox/value';
import { LineInputOriginSchema, LineTopicSchema, type LineInputOrigin, type LineKind, type LinePauseReason,
  type LineStatus, type LineTopic, type QueueStatus } from '../../shared/api/lines.ts';
import type { ModelPurpose } from '../../shared/api/model-purposes.ts';
import type { Row } from './db.ts';
import { StateError } from './errors.ts';
import { createLineDayStore } from './line-days.ts';
import { MateGroupTaskMetaSchema, type MateGroupTaskMeta } from './mate-group-task-meta.ts';
import type { StoreContext } from './object-store.ts';

export const MAIN_LINE_ID = 'line-main';
const MAIN_LINE_TITLE = '主对话';

export interface LineRow {
  id: string;
  mateId?: string | null;
  mateGroupId?: string | null;
  kind: LineKind;
  parentLineId: string | null;
  projectId: string | null;
  title: string;
  status: LineStatus;
  pauseReason: LinePauseReason | null;
  archivedAt: string | null;
  pausedUntil: string | null;
  failure: string | null;
  pauseNoticedAt: string | null;
  summary: string | null;
  summarySeq: number;
  /** 替别人答问题的线自带的系统提示（0064）：有它就只用它、不给工具；平常的线是 null。 */
  sealedPrompt: string | null;
  /** 这条线返回后，是否需要父线再综合一次；默认只贴回原结果。 */
  resumeParent: boolean;
  /** 线自己说的「没做成」那一句原因（line_outcome，0077）；做成了或没说是 null。 */
  unmetReason: string | null;
  /** 说做成没有时这条线写到第几条（0077）；之后有新的输入就不再算数。没说过是 null。 */
  verdictSeq: number | null;
  /** 旁聊围绕的那一条（0088）；别的线是 null。 */
  topic: LineTopic | null;
  /** 后台线交给发起它的线的结论（line_outcome，0088）；没写是 null。 */
  conclusion: string | null;
  /** 开线时指定的模型用途（0090）：研究周报 researcher、回顾 review……；null = 照线的种类取。 */
  modelPurpose: ModelPurpose | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewLine {
  mateId?: string | null;
  mateGroupId?: string | null;
  kind: 'background' | 'side';
  topic?: LineTopic | null;
  parentLineId: string | null;
  projectId: string | null;
  title: string;
  sealedPrompt?: string | null;
  resumeParent?: boolean;
  modelPurpose?: ModelPurpose | null;
}

export type LinePatch = Partial<Pick<LineRow, 'status' | 'pausedUntil' | 'failure' | 'pauseNoticedAt' | 'summary'
  | 'summarySeq' | 'title' | 'pauseReason' | 'archivedAt' | 'unmetReason' | 'verdictSeq' | 'conclusion'
  | 'mateId' | 'mateGroupId' | 'modelPurpose'>>;

/** 消息旁边的记录（0063）：回答想了多久、工具结果那一句。 */
export interface LineMessageMeta {
  mateGroupTask?: MateGroupTaskMeta;
  thinkingMs?: number;
  summary?: string;
  origin?: LineInputOrigin;
  /** 他给这一条加的表情反应（《优化清单》第 17 条）。 */
  reactions?: string[];
}


export interface LineMessageRow {
  lineId: string;
  seq: number;
  role: string;
  message: unknown;
  meta: LineMessageMeta | null;
  createdAt: string;
}

/** 线里一条消息的文字（记忆锚点、整理来源用）：ref 是 `line:<线>:<seq>`。 */
export interface SaidLine {
  ref: string;
  lineId: string;
  seq: number;
  role: string;
  text: string;
  origin: LineInputOrigin | null;
  createdAt: string;
}

const LINE_REF = /^line:(.+):(\d+)$/;

/** pi 消息里的文字部分（用户的字符串或文字块、助手的文字块），图和工具调用不算。 */
export function plainText(message: unknown): string {
  if (typeof message !== 'object' || message === null) {
    return '';
  }
  const content: unknown = Reflect.get(message, 'content');
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content.flatMap((part: unknown) => {
    if (typeof part !== 'object' || part === null || Reflect.get(part, 'type') !== 'text') {
      return [];
    }
    const text: unknown = Reflect.get(part, 'text');
    return typeof text === 'string' ? [text] : [];
  }).join('');
}

export function lineRef(lineId: string, seq: number): string {
  return `line:${lineId}:${seq}`;
}

export interface QueuedRow {
  id: string;
  lineId: string;
  text: string;
  attachments: string[];
  origin: LineInputOrigin;
  status: QueueStatus;
  sentSeq: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LineListFilter {
  includeArchived?: boolean;
  kind?: LineKind;
  statuses?: readonly LineStatus[];
  parentLineId?: string;
  projectId?: string;
  limit?: number;
}

const LIST_DEFAULT = 50;

function text(row: Row, key: string): string {
  return String(row[key]);
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function lineOf(row: Row): LineRow {
  return {
    id: text(row, 'id'),
    mateId: nullableText(row, 'mate_id'),
    mateGroupId: nullableText(row, 'mate_group_id'),
    kind: text(row, 'kind') as LineKind,
    parentLineId: nullableText(row, 'parent_line_id'),
    projectId: nullableText(row, 'project_id'),
    title: text(row, 'title'),
    status: text(row, 'status') as LineStatus,
    pauseReason: nullableText(row, 'pause_reason') as LinePauseReason | null,
    archivedAt: nullableText(row, 'archived_at'),
    pausedUntil: nullableText(row, 'paused_until'),
    failure: nullableText(row, 'failure'),
    pauseNoticedAt: nullableText(row, 'pause_noticed_at'),
    summary: nullableText(row, 'summary'),
    summarySeq: Number(row['summary_seq']),
    sealedPrompt: nullableText(row, 'sealed_prompt'),
    resumeParent: row['resume_parent'] === 1,
    unmetReason: nullableText(row, 'unmet_reason'),
    verdictSeq: row['verdict_seq'] === null || row['verdict_seq'] === undefined ? null : Number(row['verdict_seq']),
    topic: topicOf(row['topic']),
    conclusion: nullableText(row, 'conclusion'),
    modelPurpose: nullableText(row, 'model_purpose') as ModelPurpose | null,
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function topicOf(value: unknown): LineTopic | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const parsed: unknown = JSON.parse(value);
  return Value.Check(LineTopicSchema, parsed) ? parsed : null;
}

function metaOf(value: unknown): LineMessageMeta | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const thinkingMs: unknown = Reflect.get(parsed, 'thinkingMs');
  const summary: unknown = Reflect.get(parsed, 'summary');
  const origin: unknown = Reflect.get(parsed, 'origin');
  const reactions: unknown = Reflect.get(parsed, 'reactions');
  const mateGroupTask: unknown = Reflect.get(parsed, 'mateGroupTask');
  return { ...(typeof thinkingMs === 'number' ? { thinkingMs } : {}),
    ...(Value.Check(MateGroupTaskMetaSchema, mateGroupTask) ? { mateGroupTask } : {}),
    ...(typeof summary === 'string' ? { summary } : {}),
    ...(Array.isArray(reactions) ? { reactions: reactions.filter((item) => typeof item === 'string') } : {}),
    ...(Value.Check(LineInputOriginSchema, origin) ? { origin } : {}) };
}

function messageOf(row: Row): LineMessageRow {
  return {
    lineId: text(row, 'line_id'),
    seq: Number(row['seq']),
    role: text(row, 'role'),
    message: JSON.parse(text(row, 'message')) as unknown,
    meta: metaOf(row['meta']),
    createdAt: text(row, 'created_at'),
  };
}

function queuedOf(row: Row): QueuedRow {
  const sent = row['sent_seq'];
  const origin: unknown = typeof row['origin'] === 'string' ? JSON.parse(row['origin']) : null;
  return {
    id: text(row, 'id'),
    lineId: text(row, 'line_id'),
    text: text(row, 'text'),
    attachments: JSON.parse(text(row, 'attachments')) as string[],
    origin: Value.Check(LineInputOriginSchema, origin) ? origin : { kind: 'unknown' },
    status: text(row, 'status') as QueueStatus,
    sentSeq: sent === null || sent === undefined ? null : Number(sent),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

const PATCH_COLUMNS: Readonly<Record<keyof LinePatch, string>> = {
  mateId: 'mate_id',
  mateGroupId: 'mate_group_id',
  modelPurpose: 'model_purpose',
  status: 'status',
  pauseReason: 'pause_reason',
  archivedAt: 'archived_at',
  pausedUntil: 'paused_until',
  failure: 'failure',
  pauseNoticedAt: 'pause_noticed_at',
  summary: 'summary',
  summarySeq: 'summary_seq',
  title: 'title',
  unmetReason: 'unmet_reason',
  verdictSeq: 'verdict_seq',
  conclusion: 'conclusion',
};

function createLineTable(context: StoreContext) {
  const { db } = context;
  const get = (id: string): LineRow | undefined => {
    const row = db.get('SELECT * FROM lines WHERE id = $id', { id });
    return row === undefined ? undefined : lineOf(row);
  };
  const list = (filter: LineListFilter = {}): LineRow[] => {
    const where: string[] = filter.includeArchived === true ? [] : ['archived_at IS NULL'];
    const params: Record<string, string | number> = { limit: filter.limit ?? LIST_DEFAULT };
    if (filter.kind !== undefined) {
      where.push('kind = $kind');
      params['kind'] = filter.kind;
    }
    if (filter.parentLineId !== undefined) {
      where.push('parent_line_id = $parent');
      params['parent'] = filter.parentLineId;
    }
    if (filter.projectId !== undefined) {
      where.push('project_id = $project');
      params['project'] = filter.projectId;
    }
    if (filter.statuses !== undefined) {
      const names = filter.statuses.map((status, index) => {
        params[`status${index}`] = status;
        return `$status${index}`;
      });
      where.push(names.length === 0 ? '0' : `status IN (${names.join(', ')})`);
    }
    const clause = where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`;
    return db.all(`SELECT * FROM lines ${clause}
      ORDER BY kind = 'main' DESC, updated_at DESC, id DESC LIMIT $limit`, params).map(lineOf);
  };
  return {
    get,
    require(id: string): LineRow {
      const line = get(id);
      if (line === undefined) {
        throw new StateError('not_found', `没有这条线：${id}`);
      }
      return line;
    },
    /** 主对话那条线；第一次读时建出来（空闲）。 */
    main(): LineRow {
      const existing = db.get("SELECT * FROM lines WHERE kind = 'main'");
      if (existing !== undefined) {
        return lineOf(existing);
      }
      const at = context.now();
      db.run(`INSERT INTO lines (id, created_at, updated_at, kind, title, status)
        VALUES ($id, $at, $at, 'main', $title, 'idle')`, { id: MAIN_LINE_ID, at, title: MAIN_LINE_TITLE });
      return get(MAIN_LINE_ID)!;
    },
    create(input: NewLine): LineRow {
      const id = `line-${context.newId()}`;
      const at = context.now();
      db.run(`INSERT INTO lines (id, created_at, updated_at, kind, parent_line_id, project_id, title, status,
        sealed_prompt, resume_parent, topic, model_purpose, mate_id, mate_group_id)
        VALUES ($id, $at, $at, $kind, $parent, $project, $title, 'idle', $sealed, $resumeParent, $topic, $purpose,
          $mate, $mateGroup)`, {
        id, at, kind: input.kind, parent: input.parentLineId, project: input.projectId, title: input.title,
        sealed: input.sealedPrompt ?? null, topic: input.topic === undefined || input.topic === null ? null
          : JSON.stringify(input.topic),
        resumeParent: input.resumeParent === true ? 1 : 0,
        purpose: input.modelPurpose ?? null,
        mate: input.mateId ?? null, mateGroup: input.mateGroupId ?? null,
      });
      return get(id)!;
    },
    update(id: string, patch: LinePatch): LineRow {
      const sets: string[] = [];
      const params: Record<string, string | number | null> = { id, at: context.now() };
      for (const [key, column] of Object.entries(PATCH_COLUMNS) as [keyof LinePatch, string][]) {
        if (key in patch) {
          sets.push(`${column} = $${key}`);
          params[key] = patch[key] ?? null;
        }
      }
      if (db.run(`UPDATE lines SET ${[...sets, 'updated_at = $at'].join(', ')} WHERE id = $id`, params) === 0) {
        throw new StateError('not_found', `没有这条线：${id}`);
      }
      return get(id)!;
    },
    /** 主线在前，其余按最近动过的在前。 */
    list,
    withStatus(statuses: readonly LineStatus[]): LineRow[] {
      return list({ statuses, limit: Number.MAX_SAFE_INTEGER });
    },
  };
}

function createLineMessageTable(context: StoreContext) {
  const { db } = context;
  return {
    /** 追加一条，seq 接在这条线最后一条后面。 */
    append(lineId: string, role: string, message: unknown, meta: LineMessageMeta | null = null,
      createdAt?: string): LineMessageRow {
      return db.transaction(() => {
        const last = db.get('SELECT MAX(seq) AS seq FROM line_messages WHERE line_id = $lineId', { lineId });
        const seq = Number(last?.['seq'] ?? 0) + 1;
        db.run(`INSERT INTO line_messages (line_id, seq, role, message, meta, created_at)
          VALUES ($lineId, $seq, $role, $message, $meta, $at)`,
        { lineId, seq, role, message: JSON.stringify(message), meta: meta === null ? null : JSON.stringify(meta),
          at: createdAt ?? context.now() });
        db.run('UPDATE lines SET updated_at = $at WHERE id = $lineId', { lineId, at: context.now() });
        context.index?.changed('message', lineRef(lineId, seq));
        return messageOf(db.get('SELECT * FROM line_messages WHERE line_id = $lineId AND seq = $seq',
          { lineId, seq })!);
      });
    },
    /** seq 大于 afterSeq 的全部，从旧到新（装上下文用）。 */
    after(lineId: string, afterSeq: number): LineMessageRow[] {
      return db.all('SELECT * FROM line_messages WHERE line_id = $lineId AND seq > $after ORDER BY seq',
        { lineId, after: afterSeq }).map(messageOf);
    },
    /** 这段时间 [from, to) 里写下的消息，跨所有线，按线、再按先后（夜里的做梦把当天的对话导成纯文字）。 */
    inRange(from: string, to: string, limit: number): LineMessageRow[] {
      return db.all(`SELECT * FROM line_messages WHERE created_at >= $from AND created_at < $to
        ORDER BY line_id, seq LIMIT $limit`, { from, to, limit }).map(messageOf);
    },
    /** 一页：before 之前（不含）最新的 limit 条，从旧到新。 */
    page(lineId: string, before: number | null, limit: number): { rows: LineMessageRow[]; hasMore: boolean } {
      const rows = db.all(`SELECT * FROM line_messages WHERE line_id = $lineId AND seq < $before
        ORDER BY seq DESC LIMIT $limit`, { lineId, before: before ?? Number.MAX_SAFE_INTEGER, limit: limit + 1 })
        .map(messageOf);
      return { rows: rows.slice(0, limit).reverse(), hasMore: rows.length > limit };
    },
    get(lineId: string, seq: number): LineMessageRow | undefined {
      const row = db.get('SELECT * FROM line_messages WHERE line_id = $lineId AND seq = $seq', { lineId, seq });
      return row === undefined ? undefined : messageOf(row);
    },
    first(lineId: string, role: string): LineMessageRow | undefined {
      const row = db.get(`SELECT * FROM line_messages WHERE line_id = $lineId AND role = $role
        ORDER BY seq LIMIT 1`, { lineId, role });
      return row === undefined ? undefined : messageOf(row);
    },
    /** 成果历史只取停下或写到上限的回答；过程里的工具调用不算一版。 */
    resultBefore(lineId: string, before: number): LineMessageRow | undefined {
      const row = db.get(`SELECT * FROM line_messages WHERE line_id = $lineId AND seq < $before
        AND role = 'assistant' AND json_extract(message, '$.stopReason') IN ('stop', 'length')
        ORDER BY seq DESC LIMIT 1`, { lineId, before });
      return row === undefined ? undefined : messageOf(row);
    },
    /** 指定 seq 之前最近一条这种角色的消息；续写结果沿来源引用查找，不装整条历史。 */
    before(lineId: string, seq: number, role: string): LineMessageRow | undefined {
      const row = db.get(`SELECT * FROM line_messages WHERE line_id = $lineId AND seq < $seq AND role = $role
        ORDER BY seq DESC LIMIT 1`, { lineId, seq, role });
      return row === undefined ? undefined : messageOf(row);
    },
    /** `line:<线>:<seq>` → 那一条的文字；不是这个形状、或那一条已经没有了，就是 undefined。 */
    said(ref: string): SaidLine | undefined {
      const match = LINE_REF.exec(ref);
      if (match?.[1] === undefined || match[2] === undefined) {
        return undefined;
      }
      const row = db.get('SELECT * FROM line_messages WHERE line_id = $lineId AND seq = $seq',
        { lineId: match[1], seq: Number(match[2]) });
      if (row === undefined) {
        return undefined;
      }
      const message = messageOf(row);
      return { ref, lineId: message.lineId, seq: message.seq, role: message.role, text: plainText(message.message),
        origin: message.meta?.origin ?? null, createdAt: message.createdAt };
    },
    /** 这条线里他说过、原文含这一段的消息（新的在前，最多 limit 条）；按消息 JSON 里转义后的原文找。 */
    searchSaid(lineId: string, needle: string, limit: number): LineMessageRow[] {
      const escaped = JSON.stringify(needle).slice(1, -1);
      return db.all(`SELECT * FROM line_messages WHERE line_id = $lineId AND role = 'user'
        AND instr(message, $needle) > 0 ORDER BY seq DESC LIMIT $limit`, { lineId, needle: escaped, limit })
        .map(messageOf);
    },
    /** 补一项消息旁边的记录（表情）；别的项和消息原文不动。 */
    patchMeta(lineId: string, seq: number, patch: LineMessageMeta): LineMessageRow {
      const row = db.get('SELECT * FROM line_messages WHERE line_id = $lineId AND seq = $seq', { lineId, seq });
      if (row === undefined) {
        throw new StateError('not_found', `没有这条消息：${lineId}:${seq}`);
      }
      const meta = { ...messageOf(row).meta, ...patch };
      db.run('UPDATE line_messages SET meta = $meta WHERE line_id = $lineId AND seq = $seq',
        { lineId, seq, meta: JSON.stringify(meta) });
      return messageOf(db.get('SELECT * FROM line_messages WHERE line_id = $lineId AND seq = $seq', { lineId, seq })!);
    },
    /** 带着这个卡片小部件的那一步（show_widgets 的结果，最新的那条）。部件 id 是服务端发的，整条线里不重。 */
    withWidget(lineId: string, widgetId: string): LineMessageRow | undefined {
      const needle = JSON.stringify(widgetId);
      const row = db.get(`SELECT * FROM line_messages WHERE line_id = $lineId AND role = 'toolResult'
        AND instr(message, $needle) > 0 ORDER BY seq DESC LIMIT 1`, { lineId, needle });
      return row === undefined ? undefined : messageOf(row);
    },
    /** 换掉一条存下的消息（部件作答写回答案和状态）；seq、时间不变。 */
    replace(lineId: string, seq: number, message: unknown): LineMessageRow {
      return db.transaction(() => {
        const changed = db.run('UPDATE line_messages SET message = $message WHERE line_id = $lineId AND seq = $seq',
          { lineId, seq, message: JSON.stringify(message) });
        if (changed === 0) {
          throw new StateError('not_found', `没有这条消息：${lineId}:${seq}`);
        }
        context.index?.changed('message', lineRef(lineId, seq));
        return messageOf(db.get('SELECT * FROM line_messages WHERE line_id = $lineId AND seq = $seq',
          { lineId, seq })!);
      });
    },
    last(lineId: string, role?: string): LineMessageRow | undefined {
      const row = role === undefined
        ? db.get('SELECT * FROM line_messages WHERE line_id = $lineId ORDER BY seq DESC LIMIT 1', { lineId })
        : db.get(`SELECT * FROM line_messages WHERE line_id = $lineId AND role = $role
          ORDER BY seq DESC LIMIT 1`, { lineId, role });
      return row === undefined ? undefined : messageOf(row);
    },
  };
}

function createLineQueueTable(context: StoreContext) {
  const { db } = context;
  const get = (id: string): QueuedRow | undefined => {
    const row = db.get('SELECT * FROM line_queue WHERE id = $id', { id });
    return row === undefined ? undefined : queuedOf(row);
  };
  const setStatus = (id: string, status: QueueStatus, sentSeq: number | null): QueuedRow => {
    db.run('UPDATE line_queue SET status = $status, sent_seq = $sentSeq, updated_at = $at WHERE id = $id',
      { id, status, sentSeq, at: context.now() });
    return get(id)!;
  };
  return {
    get,
    add(lineId: string, text: string, attachments: readonly string[],
      origin: LineInputOrigin = { kind: 'unknown' }): QueuedRow {
      const id = `queued-${context.newId()}`;
      const at = context.now();
      db.run(`INSERT INTO line_queue (id, line_id, text, attachments, origin, status, created_at, updated_at)
        VALUES ($id, $lineId, $text, $attachments, $origin, 'queued', $at, $at)`,
      { id, lineId, text, attachments: JSON.stringify(attachments), origin: JSON.stringify(origin), at });
      return get(id)!;
    },
    /** 还在排的，先来的在前。 */
    /** 还没发出的（排着的和已插入这一轮的）。 */
    queued(lineId: string): QueuedRow[] {
      return db.all(`SELECT * FROM line_queue WHERE line_id = $lineId AND status IN ('queued', 'inserted')
        ORDER BY created_at, id`, { lineId }).map(queuedOf);
    },
    sent(id: string, seq: number): QueuedRow {
      return setStatus(id, 'sent', seq);
    },
    withdraw(id: string): QueuedRow {
      return setStatus(id, 'withdrawn', null);
    },
    /** 立即发送交给了正在跑的这一轮。 */
    insert(id: string): QueuedRow {
      return setStatus(id, 'inserted', null);
    },
    /** 有排队消息的线（重启后、后台线腾出位置时找下一条）。 */
    linesWithQueued(): string[] {
      return db.all(`SELECT line_id, MIN(created_at) AS first FROM line_queue WHERE status IN ('queued', 'inserted')
        GROUP BY line_id ORDER BY first`).map((row) => text(row, 'line_id'));
    },
  };
}

export function createLineStores(context: StoreContext) {
  return {
    lines: createLineTable(context),
    lineMessages: createLineMessageTable(context),
    lineQueue: createLineQueueTable(context),
    lineDays: createLineDayStore(context),
  };
}

export type LineStores = ReturnType<typeof createLineStores>;
