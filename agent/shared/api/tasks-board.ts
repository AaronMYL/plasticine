import { Type, type Static } from 'typebox';
import { SUGGESTION_ICONS, SUGGESTION_SOURCES } from '../state-tasks.ts';
import { AskViewSchema } from './asks.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema, TimeZoneSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { LineViewSchema, type LineView } from './lines.ts';
import { PROJECT_HUES } from './project-tag.ts';
import { TimerViewSchema } from './timers.ts';

const STRICT = { additionalProperties: false };

export const TASKS_PATH = `${API_PREFIX}/tasks`;
export const TASKS_BOARD_PATH = `${TASKS_PATH}/board`;
export const TIMED_ENABLE_PATH = `${TASKS_PATH}/timed/enable`;
export const TIMED_REMOVE_PATH = `${TASKS_PATH}/timed/remove`;
export const TEAMMATE_STOP_PATH = `${TASKS_PATH}/teammates/stop`;
export const SUGGESTIONS_PATH = `${TASKS_PATH}/suggestions`;
export const DEVICE_TIME_ZONE_PATH = `${TASKS_PATH}/time-zone`;

export const TASKS_ENDED_MAX = 50;
export const TASKS_DELETED_MAX = 50;

type TaskLine = Pick<LineView, 'status' | 'pauseReason' | 'outcome' | 'archivedAt'>;

export function taskInProgress(line: TaskLine): boolean {
  if (line.archivedAt != null) return false;
  if (line.status === 'paused') return line.pauseReason !== 'stopped';
  return line.status === 'running' || line.status === 'queued' || line.status === 'waiting';
}

export function taskEnded(line: TaskLine): boolean {
  if (line.archivedAt != null) return false;
  if (line.status === 'paused') return line.pauseReason === 'stopped';
  return (line.status === 'idle' || line.status === 'failed') && line.outcome !== null;
}

export const TIMED_SOURCES = ['schedule', 'subscription', 'review', 'dream', 'heartbeat'] as const;
export type TimedSource = (typeof TIMED_SOURCES)[number];
export const TIMED_ICONS = ['clock', 'play', 'pulse', 'moon', 'sparkle', 'space', 'file', 'mail'] as const;
export const TASK_GLYPHS = ['run', 'wait', 'done', 'pause', 'err', 'idle'] as const;
export type TaskGlyph = (typeof TASK_GLYPHS)[number];

const GlyphSchema = Type.Enum(TASK_GLYPHS);
const HueSchema = Type.Enum(PROJECT_HUES);

export const TimedRowViewSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 200 }),
  source: Type.Enum(TIMED_SOURCES),
  title: Type.String(),
  summary: Type.String(),
  icon: Type.Enum(TIMED_ICONS),
  hue: HueSchema,
  nextAt: OrNull(IsoTimeSchema),
  last: OrNull(Type.Object({ glyph: GlyphSchema, text: Type.String() }, STRICT)),
  enabled: Type.Boolean(),
  canToggle: Type.Boolean(),
  canRemove: Type.Boolean(),
  projectId: IdSchema,
  lineId: OrNull(IdSchema),
  askId: OrNull(IdSchema),
  teammateId: Type.String({ minLength: 1, maxLength: 200 }),
  sheet: Type.Boolean(),
}, STRICT);
export type TimedRowView = Static<typeof TimedRowViewSchema>;

export const TeammateViewSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 200 }),
  name: Type.String(),
  icon: Type.Enum(TIMED_ICONS),
  hue: HueSchema,
  glyph: GlyphSchema,
  now: Type.String(),
  rowIds: Type.Array(Type.String()),
  lineId: OrNull(IdSchema),
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

export const TasksBoardQuerySchema = Type.Object({ projectId: Type.Optional(IdSchema) }, STRICT);
export type TasksBoardQuery = Static<typeof TasksBoardQuerySchema>;

export const TasksBoardResponseSchema = Type.Object({
  projectId: OrNull(IdSchema),
  counts: TaskCountsSchema,
  running: Type.Array(LineViewSchema),
  waiting: Type.Array(AskViewSchema),
  ended: Type.Array(LineViewSchema),
  deleted: Type.Array(LineViewSchema),
  timed: Type.Array(TimedRowViewSchema),
  ideas: Type.Array(SuggestionViewSchema),
  teammates: Type.Array(TeammateViewSchema),
  projects: Type.Array(TaskProjectViewSchema),
  timers: Type.Optional(Type.Array(TimerViewSchema)),
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

export const SUGGESTION_ACTIONS = ['start', 'todo', 'dismiss'] as const;
export type SuggestionAction = (typeof SUGGESTION_ACTIONS)[number];
export const SuggestionActionRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type SuggestionActionRequest = Static<typeof SuggestionActionRequestSchema>;
export const SuggestionActionResponseSchema = Type.Object({
  suggestion: SuggestionViewSchema,
  lineId: OrNull(IdSchema),
  projectId: OrNull(IdSchema),
}, STRICT);
export type SuggestionActionResponse = Static<typeof SuggestionActionResponseSchema>;

export const DeviceTimeZoneRequestSchema = Type.Object({ timeZone: TimeZoneSchema }, STRICT);
export type DeviceTimeZoneRequest = Static<typeof DeviceTimeZoneRequestSchema>;
export const DeviceTimeZoneResponseSchema = Type.Object({
  timeZone: TimeZoneSchema,
}, STRICT);
export type DeviceTimeZoneResponse = Static<typeof DeviceTimeZoneResponseSchema>;
