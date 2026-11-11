// 任务栏目（《优化清单》第 3、4、5 条，用户 11-06 定，11-07 补）的接口：第二栏的列表（在做 / 等你 / 定时 / 建议 / 项目，
// 带个数）、定时的开关和删除、建议的开始 / 加成待办 / 忽略、队友（每件长期的事看得见的执行者）、设备报时区，
// 以及对话里定时卡的样子。项目页用同一份数据（?projectId=）。

import { Type, type Static } from 'typebox';
import { SUGGESTION_ICONS, SUGGESTION_SOURCES } from '../state-tasks.ts';
import { AskViewSchema } from './asks.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema, TimeZoneSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { LineViewSchema, type LineView } from './lines.ts';
import { PROJECT_HUES } from './project-tag.ts';

const STRICT = { additionalProperties: false };

export const TASKS_PATH = `${API_PREFIX}/tasks`;
export const TASKS_BOARD_PATH = `${TASKS_PATH}/board`;
export const TIMED_ENABLE_PATH = `${TASKS_PATH}/timed/enable`;
export const TIMED_REMOVE_PATH = `${TASKS_PATH}/timed/remove`;
export const TEAMMATE_STOP_PATH = `${TASKS_PATH}/teammates/stop`;
export const SUGGESTIONS_PATH = `${TASKS_PATH}/suggestions`;
/** 设备报自己现在的时区（11-07 定：定时按他设备当前的时区算）。 */
export const DEVICE_TIME_ZONE_PATH = `${TASKS_PATH}/time-zone`;

/** 「已结束」最多列这么多条：完整的在对话和工作详情里。 */
export const TASKS_ENDED_MAX = 50;
/** 「最近删除」最多列这么多条。 */
export const TASKS_DELETED_MAX = 50;

type TaskLine = Pick<LineView, 'status' | 'pauseReason' | 'outcome' | 'archivedAt'>;

/** 进行中（11-11）：在跑、排队、在等，和暂停着的；停止的、删除的不算。 */
export function taskInProgress(line: TaskLine): boolean {
  if (line.archivedAt != null) return false;
  if (line.status === 'paused') return line.pauseReason !== 'stopped';
  return line.status === 'running' || line.status === 'queued' || line.status === 'waiting';
}

/** 已结束：这一轮有了结果（做完、没做成、出错）或他停止了。 */
export function taskEnded(line: TaskLine): boolean {
  if (line.archivedAt != null) return false;
  if (line.status === 'paused') return line.pauseReason === 'stopped';
  return (line.status === 'idle' || line.status === 'failed') && line.outcome !== null;
}

/** 定时一行是谁家的：定时线（本线）、订阅、回顾（日报周报）、做梦、心跳（后面的线登记进来）。 */
export const TIMED_SOURCES = ['schedule', 'subscription', 'review', 'dream', 'heartbeat'] as const;
export type TimedSource = (typeof TIMED_SOURCES)[number];
/** 行首图标块。 */
export const TIMED_ICONS = ['clock', 'play', 'pulse', 'moon', 'sparkle', 'space', 'file', 'mail'] as const;
export type TimedIcon = (typeof TIMED_ICONS)[number];
/** 状态符（shell/glyph.tsx）：在做 / 等你 / 做完 / 暂停 / 出错 / 没开始。 */
export const TASK_GLYPHS = ['run', 'wait', 'done', 'pause', 'err', 'idle'] as const;
export type TaskGlyph = (typeof TASK_GLYPHS)[number];

const GlyphSchema = Type.Enum(TASK_GLYPHS);
const HueSchema = Type.Enum(PROJECT_HUES);

/** 定时列表的一行：做什么、下次什么时候跑、上次结果；能暂停（开关）、能删。 */
export const TimedRowViewSchema = Type.Object({
  /** 来源 + 它自己的 id（schedule:<id>、heartbeat）：开关、删除、点开都按它。 */
  id: Type.String({ minLength: 1, maxLength: 200 }),
  source: Type.Enum(TIMED_SOURCES),
  title: Type.String(),
  /** 第二行：「每天 15:00 · 以你的名义发出」。 */
  summary: Type.String(),
  icon: Type.Enum(TIMED_ICONS),
  hue: HueSchema,
  /** 下次什么时候跑；停了、等确认的是 null。 */
  nextAt: OrNull(IsoTimeSchema),
  last: OrNull(Type.Object({ glyph: GlyphSchema, text: Type.String() }, STRICT)),
  enabled: Type.Boolean(),
  /** 开关能不能拨：等他确认的卡不能（要在卡上确认）。 */
  canToggle: Type.Boolean(),
  canRemove: Type.Boolean(),
  /** 归哪个项目（没归的进「个人」）。 */
  projectId: IdSchema,
  /** 它的线（在跑时点进去看）；还没跑过是 null。 */
  lineId: OrNull(IdSchema),
  /** 等他确认的那张卡（点这一行回到卡上）。 */
  askId: OrNull(IdSchema),
  /** 队友：这一行由谁做（同一位可以管几行，回顾管日报和周报）。 */
  teammateId: Type.String({ minLength: 1, maxLength: 200 }),
  /** 点开出右侧弹层（心跳那样的设置），没有弹层的是 false。 */
  sheet: Type.Boolean(),
}, STRICT);
export type TimedRowView = Static<typeof TimedRowViewSchema>;

/** 队友（第 5 条）：每件长期的事一个看得见的执行者——名字、正在做什么、上次做了什么，可以叫停。 */
export const TeammateViewSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 200 }),
  name: Type.String(),
  icon: Type.Enum(TIMED_ICONS),
  hue: HueSchema,
  glyph: GlyphSchema,
  /** 一行：在做的那一步，或上次做了什么（「14:30 看过，没事」）。 */
  now: Type.String(),
  rowIds: Type.Array(Type.String()),
  lineId: OrNull(IdSchema),
  /** 叫停：停掉它管的每一行（正在跑的那一轮也停）。都停着就不用再叫停。 */
  canStop: Type.Boolean(),
}, STRICT);
export type TeammateView = Static<typeof TeammateViewSchema>;

export const SuggestionViewSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  why: Type.String(),
  icon: Type.Enum(SUGGESTION_ICONS),
  source: Type.Enum(SUGGESTION_SOURCES),
  projectId: OrNull(IdSchema),
  createdAt: IsoTimeSchema,
}, STRICT);
export type SuggestionView = Static<typeof SuggestionViewSchema>;

export const TaskCountsSchema = Type.Object({
  running: Type.Integer({ minimum: 0 }),
  waiting: Type.Integer({ minimum: 0 }),
  ended: Type.Integer({ minimum: 0 }),
  deleted: Type.Integer({ minimum: 0 }),
  timed: Type.Integer({ minimum: 0 }),
  ideas: Type.Integer({ minimum: 0 }),
}, STRICT);
export type TaskCounts = Static<typeof TaskCountsSchema>;

export const TaskProjectViewSchema = Type.Object({
  id: IdSchema,
  name: Type.String(),
  hue: HueSchema,
  counts: TaskCountsSchema,
}, STRICT);
export type TaskProjectView = Static<typeof TaskProjectViewSchema>;

/** GET /v2/tasks/board?projectId=：不带是全部；带了只给这个项目的那部分（项目页用）。 */
export const TasksBoardQuerySchema = Type.Object({ projectId: Type.Optional(IdSchema) }, STRICT);
export type TasksBoardQuery = Static<typeof TasksBoardQuerySchema>;

export const TasksBoardResponseSchema = Type.Object({
  projectId: OrNull(IdSchema),
  counts: TaskCountsSchema,
  /** 进行中（11-11）：在跑、排队、在等、暂停着的后台线（停止的不算）。 */
  running: Type.Array(LineViewSchema),
  /** 等你：等他决定的卡。 */
  waiting: Type.Array(AskViewSchema),
  /** 已结束：做完、没做成、出错、他停止的，新的在前。 */
  ended: Type.Array(LineViewSchema),
  /** 最近删除：删掉的后台线，能恢复。 */
  deleted: Type.Array(LineViewSchema),
  timed: Type.Array(TimedRowViewSchema),
  ideas: Type.Array(SuggestionViewSchema),
  teammates: Type.Array(TeammateViewSchema),
  /** 项目（列在最下面），各带自己那部分的个数。 */
  projects: Type.Array(TaskProjectViewSchema),
}, STRICT);
export type TasksBoardResponse = Static<typeof TasksBoardResponseSchema>;

export const TimedEnableRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  rowId: Type.String({ minLength: 1, maxLength: 200 }),
  on: Type.Boolean(),
}, STRICT);
export type TimedEnableRequest = Static<typeof TimedEnableRequestSchema>;

export const TimedRemoveRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  rowId: Type.String({ minLength: 1, maxLength: 200 }),
}, STRICT);
export type TimedRemoveRequest = Static<typeof TimedRemoveRequestSchema>;

export const TimedRowResponseSchema = Type.Object({ row: OrNull(TimedRowViewSchema) }, STRICT);
export type TimedRowResponse = Static<typeof TimedRowResponseSchema>;

export const TeammateStopRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  teammateId: Type.String({ minLength: 1, maxLength: 200 }),
}, STRICT);
export type TeammateStopRequest = Static<typeof TeammateStopRequestSchema>;

export const TeammateResponseSchema = Type.Object({ teammate: OrNull(TeammateViewSchema) }, STRICT);
export type TeammateResponse = Static<typeof TeammateResponseSchema>;

/** POST /v2/tasks/suggestions/:id/(start|todo|dismiss)。 */
export const SUGGESTION_ACTIONS = ['start', 'todo', 'dismiss'] as const;
export type SuggestionAction = (typeof SUGGESTION_ACTIONS)[number];
export const SuggestionActionRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type SuggestionActionRequest = Static<typeof SuggestionActionRequestSchema>;
export const SuggestionActionResponseSchema = Type.Object({
  suggestion: SuggestionViewSchema,
  /** 开始做：开的那条后台线。 */
  lineId: OrNull(IdSchema),
  /** 加成待办：加到的那个项目。 */
  projectId: OrNull(IdSchema),
}, STRICT);
export type SuggestionActionResponse = Static<typeof SuggestionActionResponseSchema>;

export const DeviceTimeZoneRequestSchema = Type.Object({ timeZone: TimeZoneSchema }, STRICT);
export type DeviceTimeZoneRequest = Static<typeof DeviceTimeZoneRequestSchema>;
export const DeviceTimeZoneResponseSchema = Type.Object({
  /** 定时现在按哪个时区算（设置里选了的以设置为准）。 */
  timeZone: TimeZoneSchema,
}, STRICT);
export type DeviceTimeZoneResponse = Static<typeof DeviceTimeZoneResponseSchema>;
