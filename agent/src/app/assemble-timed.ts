import { loopReadings, writeSelfNotes } from '../loop/index.ts';
import { mainIdentity, soulNight } from '../mates/index.ts';
import { randomUUID } from 'node:crypto';
import type { NoticeInput } from '../attention/index.ts';
import { Dreamer, DreamNight, proactiveDocSection, type DreamSkills } from '../memory/index.ts';
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
  text: TextModels | null;
  skills: SkillStore;
  notify: (input: NoticeInput) => boolean;
  stalled: (now: Date) => { id: string; name: string }[];
  calendar?: CalendarPort;
}

export interface TimedAssembly {
  heartbeat: Heartbeat;
  dreamNight: DreamNight;
  subscriptions: SubscriptionTimed;
}

function dreamSkills(skills: SkillStore): DreamSkills {
  return {
    exists: (name) => skills.search(name).skills.some((skill) => skill.name === name),
    write: (name, content, actionId) => {
      skills.write({ name, content, expectedVersion: null }, { actionId, runId: actionId, taskId: null });
    },
  };
}

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
    preferences: () => proactiveDocSection(state),
    stalled: parts.stalled,
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
    souls: (from, to, signal) => soulNight(state, text, mainIdentity(state).name, from.toISOString(),
      to.toISOString(), signal),
    dreamer: () => (text === null ? null : new Dreamer({ state, models: text, skills: dreamSkills(parts.skills),
      now,
      suggest: (loop) => {
        tasks.suggestions.suggest({ ...loop, projectId: null, source: 'dream', icon: 'sparkle' });
      } })) });
  for (const provider of [...subscriptions.providers(), heartbeat.provider(), dreamNight.provider()]) {
    tasks.timed.register(provider);
  }
  return { heartbeat, dreamNight, subscriptions };
}
