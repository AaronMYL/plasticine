// 心跳先用代码筛（《优化清单》第 11 条）：按清单上的每一条去库里读这一跳看得到的事，一件一个稳定的 key
// （同一件事下一跳还在，key 不变），写成一句话。比对 key 就知道距离上一跳有没有新变化，没有就不叫模型。

import type { HeartbeatItem } from '../../shared/api/index.ts';
import type { HeartbeatFact } from '../../shared/state.ts';
import { localDay } from '../daily/index.ts';
import type { StateService } from '../state/index.ts';

const HOUR_MS = 60 * 60 * 1000;
/** 等他超过 4 小时算「等太久」（设计稿那一条的原文）。 */
export const WAITING_TOO_LONG_MS = 4 * HOUR_MS;
/** 邮件看最近两天的：再早的他多半已经处理过或不打算回。 */
const MAIL_WINDOW_MS = 48 * HOUR_MS;
/** 后台结果、信息流看最近一天的。 */
const DAY_WINDOW_MS = 24 * HOUR_MS;
/** 日历冲突看接下来两小时（11-06 定）。 */
export const CALENDAR_AHEAD_MS = 2 * HOUR_MS;
const TEXT_MAX_CHARS = 160;

export type FactState = Pick<StateService, 'heartbeatFacts'>;

/** Apple 日历是第四段的事：先留接口，没有日历就跳过这一条。 */
export interface CalendarPort {
  conflicts(from: Date, to: Date): { id: string; text: string }[];
}

/** 两周没动静的项目（attention/ 的 ProjectWatch.stalled，原来「项目逾期、停滞」那条规则的另一半）。 */
export type StalledPort = (now: Date) => { id: string; name: string }[];

/**
 * 没做成的后台任务（11-12 主动性一批）：出错停下的、做完了但自己说没做成的。不在他那张清单上、也删不掉——
 * 事情没做成没人跟，是 Plasticine 自己的事，不该等他来发现。
 */
export type StuckPort = (since: Date) => { lineId: string; title: string; reason: string }[];

export interface FactContext {
  state: FactState;
  now: Date;
  zone: string;
  calendar?: CalendarPort;
  stalled?: StalledPort;
  stuck?: StuckPort;
}

/** 这一类事在材料里叫什么（模型按它判断，界面上的「上次看到了什么」也用它）。 */
export const STUCK_ITEM = '没做成的后台任务';
/** 心跳替没做成的任务开的跟进线，标题带这个头；它自己再没做成，心跳不再跟（只跟一次，免得一直转）。 */
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
        `${row.kind === 'mail.known_sender' ? '来信' : '会议邀请'}：${row.from}《${row.title}》`));
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
      // 停滞按周算一件：同一个项目一周只算一次新变化。
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

/** 没做成的后台任务：最近一天的，一件一个 key（同一件只算一次新变化）。 */
function stuckFacts(context: FactContext): HeartbeatFact[] {
  return (context.stuck?.(new Date(context.now.getTime() - DAY_WINDOW_MS)) ?? []).map((row) => ({
    key: `stuck:${row.lineId}`, item: STUCK_ITEM,
    text: clip(`后台任务「${row.title}」没做成（line:${row.lineId}）：${row.reason}`) }));
}

/** 这一跳看到的全部；清单里删掉的那一类不看。没做成的后台任务不看清单，总是看。 */
export function collectFacts(items: readonly HeartbeatItem[], context: FactContext): HeartbeatFact[] {
  return [...items.flatMap((item) => factsFor(item, context)), ...stuckFacts(context)];
}

/** 比上一跳多出来的（上一跳没见过的 key）。 */
export function freshFacts(facts: readonly HeartbeatFact[], seen: readonly string[]): HeartbeatFact[] {
  const known = new Set(seen);
  return facts.filter((fact) => !known.has(fact.key));
}
