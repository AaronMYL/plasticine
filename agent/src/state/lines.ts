import { Value } from 'typebox/value';
import {
  LineInputOriginSchema, LineTopicSchema, type LineInputOrigin, type LineKind, type LinePauseReason, type LineStatus,
  type LineTopic,
} from '../../shared/api/lines.ts';
import type { ModelPurpose } from '../../shared/api/model-purposes.ts';
import type { Row } from './db.ts';
import { StateError } from './errors.ts';
import { createLineDayStore } from './line-days.ts';
import { createLineQueueTable } from './line-queue.ts';
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
  sealedPrompt: string | null;
  resumeParent: boolean;
  unmetReason: string | null;
  verdictSeq: number | null;
  topic: LineTopic | null;
  conclusion: string | null;
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

export interface LineMessageMeta {
  mateGroupTask?: MateGroupTaskMeta;
  thinkingMs?: number;
  summary?: string;
  origin?: LineInputOrigin;
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

export interface LineListFilter {
  includeArchived?: boolean;
  visibleOnly?: boolean;
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
    if (filter.visibleOnly === true) {
      where.push('sealed_prompt IS NULL');
    }
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
    list,
    withStatus(statuses: readonly LineStatus[]): LineRow[] {
      return list({ statuses, limit: Number.MAX_SAFE_INTEGER });
    },
  };
}

function createLineMessageTable(context: StoreContext) {
  const { db } = context;
  return {
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
    after(lineId: string, afterSeq: number): LineMessageRow[] {
      return db.all('SELECT * FROM line_messages WHERE line_id = $lineId AND seq > $after ORDER BY seq',
        { lineId, after: afterSeq }).map(messageOf);
    },
    inRange(from: string, to: string, limit: number): LineMessageRow[] {
      return db.all(`SELECT * FROM line_messages WHERE created_at >= $from AND created_at < $to
        ORDER BY line_id, seq LIMIT $limit`, { from, to, limit }).map(messageOf);
    },
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
    toolResult(lineId: string, toolCallId: string): LineMessageRow | undefined {
      const row = db.get(`SELECT * FROM line_messages WHERE line_id = $lineId AND role = 'toolResult'
        AND json_extract(message, '$.toolCallId') = $toolCallId ORDER BY seq DESC LIMIT 1`,
      { lineId, toolCallId });
      return row === undefined ? undefined : messageOf(row);
    },
    first(lineId: string, role: string): LineMessageRow | undefined {
      const row = db.get(`SELECT * FROM line_messages WHERE line_id = $lineId AND role = $role
        ORDER BY seq LIMIT 1`, { lineId, role });
      return row === undefined ? undefined : messageOf(row);
    },
    lastDelegation(lineId: string): LineMessageRow | undefined {
      const row = db.get(`SELECT * FROM line_messages WHERE line_id = $lineId AND role = 'user'
        AND json_extract(meta, '$.origin.kind') = 'delegation' AND json_extract(meta, '$.origin.ref') IS NOT NULL
        ORDER BY seq DESC LIMIT 1`, { lineId });
      return row === undefined ? undefined : messageOf(row);
    },
    resultBefore(lineId: string, before: number): LineMessageRow | undefined {
      const row = db.get(`SELECT * FROM line_messages WHERE line_id = $lineId AND seq < $before
        AND role = 'assistant' AND json_extract(message, '$.stopReason') IN ('stop', 'length')
        ORDER BY seq DESC LIMIT 1`, { lineId, before });
      return row === undefined ? undefined : messageOf(row);
    },
    before(lineId: string, seq: number, role: string): LineMessageRow | undefined {
      const row = db.get(`SELECT * FROM line_messages WHERE line_id = $lineId AND seq < $seq AND role = $role
        ORDER BY seq DESC LIMIT 1`, { lineId, seq, role });
      return row === undefined ? undefined : messageOf(row);
    },
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
    searchSaid(lineId: string, needle: string, limit: number): LineMessageRow[] {
      const escaped = JSON.stringify(needle).slice(1, -1);
      return db.all(`SELECT * FROM line_messages WHERE line_id = $lineId AND role = 'user'
        AND instr(message, $needle) > 0 ORDER BY seq DESC LIMIT $limit`, { lineId, needle: escaped, limit })
        .map(messageOf);
    },
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
    withWidget(lineId: string, widgetId: string): LineMessageRow | undefined {
      const needle = JSON.stringify(widgetId);
      const row = db.get(`SELECT * FROM line_messages WHERE line_id = $lineId AND role = 'toolResult'
        AND instr(message, $needle) > 0 ORDER BY seq DESC LIMIT 1`, { lineId, needle });
      return row === undefined ? undefined : messageOf(row);
    },
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

export function createLineStores(context: StoreContext) {
  return {
    lines: createLineTable(context),
    lineMessages: createLineMessageTable(context),
    lineQueue: createLineQueueTable(context),
    lineDays: createLineDayStore(context),
  };
}

export type LineStores = ReturnType<typeof createLineStores>;
