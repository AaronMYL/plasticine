import type { HeartbeatItem } from '../../shared/api/index.ts';
import type { HeartbeatFact } from '../../shared/state.ts';
import { localDay } from '../daily/index.ts';
import type { StateService } from '../state/index.ts';

const HOUR_MS = 60 * 60 * 1000;
export const WAITING_TOO_LONG_MS = 4 * HOUR_MS;
const MAIL_WINDOW_MS = 48 * HOUR_MS;
const DAY_WINDOW_MS = 24 * HOUR_MS;
export const CALENDAR_AHEAD_MS = 2 * HOUR_MS;
const TEXT_MAX_CHARS = 160;

export type FactState = Pick<StateService, 'heartbeatFacts'>;

export interface CalendarPort {
  conflicts(from: Date, to: Date): { id: string; text: string }[];
}

export type StalledPort = (now: Date) => { id: string; name: string }[];

export type StuckPort = (since: Date) => { lineId: string; title: string; reason: string }[];

export interface FactContext {
  state: FactState;
  now: Date;
  zone: string;
  calendar?: CalendarPort;
  stalled?: StalledPort;
  stuck?: StuckPort;
  readings?: (now: Date) => HeartbeatFact[];
}

export const STUCK_ITEM = '没做成的后台任务';
export const FOLLOW_UP_PREFIX = '跟进：';

const WEEK_MS = 7 * DAY_WINDOW_MS;

function clip(text: string): string {
  const chars = Array.from(text.trim().replace(/\s+/g, ' '));
  return chars.length <= TEXT_MAX_CHARS ? chars.join('') : `${chars.slice(0, TEXT_MAX_CHARS - 1).join('')}…`;
}

function since(now: Date, ms: number): string {
  return new Date(now.getTime() - ms).toISOString();
}

function factsFor(item: HeartbeatItem, context: FactContext): HeartbeatFact[] {
  const { state, now } = context;
  const facts = state.heartbeatFacts;
  const fact = (key: string, text: string): HeartbeatFact => ({ key, item: item.text, text: clip(text) });
  switch (item.kind) {
    case 'mail':
      return facts.mail(since(now, MAIL_WINDOW_MS)).map((row) => fact(`mail:${row.id}`,
        `${row.kind === 'known_sender' ? '来信' : '会议邀请'}：${row.from}《${row.title}》`));
    case 'calendar':
      return (context.calendar?.conflicts(now, new Date(now.getTime() + CALENDAR_AHEAD_MS)) ?? [])
        .map((row) => fact(`calendar:${row.id}`, row.text));
    case 'waiting':
      return facts.waiting(since(now, WAITING_TOO_LONG_MS)).map((row) => fact(`waiting:${row.kind}:${row.id}`,
        `${row.kind === 'line' ? '线' : '卡'}「${row.title}」从 ${row.since} 起等他`));
    case 'results':
      return facts.results(since(now, DAY_WINDOW_MS)).map((row) => fact(`result:${row.lineId}:${row.updatedAt}`,
        `后台线「${row.title}」做完了（line:${row.lineId}）`));
    case 'friends':
      return facts.friends().map((row) => fact(`friend:${row.kind}:${row.id}`,
        `${row.contact || '朋友'}${row.kind === 'task' ? '发来任务卡' : '说'}：${row.text}`));
    case 'due': {
      const due = facts.due(localDay(now, context.zone)).map((row) => fact(`due:${row.kind}:${row.id}:${row.due}`,
        row.kind === 'todo' ? `项目「${row.project}」的待办「${row.title}」${row.due} 到期`
          : `项目「${row.project}」过了截止日 ${row.due}`));
      const week = Math.floor(now.getTime() / WEEK_MS);
      const stalled = (context.stalled?.(now) ?? []).map((project) => fact(`stall:${project.id}:${week}`,
        `项目「${project.name}」两周没有动静`));
      return [...due, ...stalled];
    }
    case 'feed':
      return facts.feed(since(now, DAY_WINDOW_MS)).map((row) => fact(`feed:${row.id}`, `信息流：${row.title}`));
    case 'custom':
      return [];
  }
}

function stuckFacts(context: FactContext): HeartbeatFact[] {
  return (context.stuck?.(new Date(context.now.getTime() - DAY_WINDOW_MS)) ?? []).map((row) => ({
    key: `stuck:${row.lineId}`, item: STUCK_ITEM,
    text: clip(`后台任务「${row.title}」没做成（line:${row.lineId}）：${row.reason}`) }));
}

export function collectFacts(items: readonly HeartbeatItem[], context: FactContext): HeartbeatFact[] {
  return [...items.flatMap((item) => factsFor(item, context)), ...stuckFacts(context),
    ...(context.readings?.(context.now) ?? [])];
}

export function freshFacts(facts: readonly HeartbeatFact[], seen: readonly string[]): HeartbeatFact[] {
  const known = new Set(seen);
  return facts.filter((fact) => !known.has(fact.key));
}
