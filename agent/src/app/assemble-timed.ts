// 登记进「任务 · 定时」的那几样（第 6 批二段 night 线）：订阅（研究周报、个人回顾的日报 / 周报）、心跳、做梦。
// 都用 tasks 的计时器（每分钟看一眼）；各自到点做什么在 subs/、heartbeat/、dream/。线、通知后面才装好，这里按需取。

import { loopReadings } from '../loop/readings.ts';
import { writeSelfNotes } from '../loop/self-notes.ts';
import { randomUUID } from 'node:crypto';
import type { NoticeInput } from '../attention/index.ts';
import { Dreamer, type DreamSkills } from '../brain/index.ts';
import { DreamNight } from '../dream/index.ts';
import { FOLLOW_UP_PREFIX, Heartbeat, type CalendarPort } from '../heartbeat/index.ts';
import type { TextModels } from '../kernel/index.ts';
import type { LineKernel } from '../lines/index.ts';
import type { SkillStore } from '../skills/index.ts';
import { MAIN_LINE_ID, type StateService } from '../state/index.ts';
import { SubscriptionTimed } from '../subs/index.ts';
import type { Tasks } from '../tasks/index.ts';
import type { EventHub } from './event-hub.ts';
import { linePort } from './subscriptions.ts';

export interface TimedParts {
  state: StateService;
  now: () => Date;
  hub: EventHub;
  tasks: Tasks;
  lines: () => LineKernel;
  /** 心跳、做梦的模型；null = 不叫模型（测试默认，和记忆整理同一个开关）。 */
  text: TextModels | null;
  skills: SkillStore;
  notify: (input: NoticeInput) => boolean;
  stalled: (now: Date) => { id: string; name: string }[];
  /** 第 15 条：心跳的「接下来两小时的日历冲突」读日历缓存。 */
  calendar?: CalendarPort;
}

export interface TimedAssembly {
  heartbeat: Heartbeat;
  dreamNight: DreamNight;
  subscriptions: SubscriptionTimed;
}

/** 做成的新做法写成技能：只新建，已有的不在夜里改。 */
function dreamSkills(skills: SkillStore): DreamSkills {
  return {
    exists: (name) => skills.search(name).skills.some((skill) => skill.name === name),
    write: (name, content, actionId) => {
      skills.write({ name, content, expectedVersion: null }, { actionId, runId: actionId, taskId: null });
    },
  };
}

/** 定时的订阅和回顾过了这么久还没出，心跳补一期。 */
const CATCH_UP_GRACE_MS = 60 * 60_000;

export function assembleTimed(parts: TimedParts): TimedAssembly {
  const { state, now, hub, tasks } = parts;
  const zone = (): string => tasks.schedules.timeZone();
  const changed = (): void => {
    hub.publish({ type: 'tasks_changed' });
  };
  const view = (lineId: string) => (state.lines.get(lineId) === undefined ? null : parts.lines().view(lineId));
  const subscriptions = new SubscriptionTimed({ state, now, zone, changed,
    lines: { port: () => linePort(parts.lines()), view, halt: (lineId) => {
      parts.lines().halt(lineId);
    } },
    suggest: (input) => {
      tasks.suggestions.suggest(input);
    } });
  const heartbeat = new Heartbeat({ state, now, zone, changed, models: parts.text,
    notify: parts.notify,
    open: (input) => parts.lines().open({ ...input, projectId: null, parentLineId: MAIN_LINE_ID,
      origin: { kind: 'trigger', ref: 'heartbeat' } }).id,
    suggest: (input) => tasks.suggestions.suggest(input),
    stalled: parts.stalled,
    // 没做成的后台任务：出错停下的，和做完了但自己说没做成的；心跳开的跟进线自己再失败不再跟（免得一直转）。
    stuck: (since) => state.lines.list({ kind: 'background', visibleOnly: true, limit: 200 })
      .filter((line) => line.archivedAt === null && Date.parse(line.updatedAt) >= since.getTime()
        && (line.status === 'failed' || (line.status === 'idle' && line.unmetReason !== null))
        && !line.title.startsWith(FOLLOW_UP_PREFIX))
      .map((line) => ({ lineId: line.id, title: line.title,
        reason: line.failure ?? line.unmetReason ?? '原因没记下' })),
    catchUp: (at) => subscriptions.catchUp(at, CATCH_UP_GRACE_MS),
    readings: (at) => loopReadings(state, at),
    ...(parts.calendar === undefined ? {} : { calendar: parts.calendar }),
    newId: () => `item-${randomUUID().slice(0, 8)}` });
  const text = parts.text;
  const dreamNight = new DreamNight({ state, now, zone, changed, limit: () => parts.lines().backgroundLimit(),
    selfNotes: (at, signal) => writeSelfNotes(state, text, at, signal),
    dreamer: () => (text === null ? null : new Dreamer({ state, models: text, skills: dreamSkills(parts.skills),
      now,
      // 做梦时发现的没了结的事进「任务 · 建议」，他点了才做（11-12 主动性一批）。
      suggest: (loop) => {
        tasks.suggestions.suggest({ ...loop, projectId: null, source: 'dream', icon: 'sparkle' });
      } })) });
  for (const provider of [...subscriptions.providers(), heartbeat.provider(), dreamNight.provider()]) {
    tasks.timed.register(provider);
  }
  return { heartbeat, dreamNight, subscriptions };
}
