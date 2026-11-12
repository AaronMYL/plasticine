// 心跳（《优化清单》第 11 条，11-06 定；参考 OpenClaw 的 Heartbeat）：默认每 30 分钟看一眼一张很短的清单，23:00–08:00
// 不跳（他所在地的时区）。先用代码筛：和上一跳比没有新出现的事就跳过，不叫模型；有新变化才叫模型（用途 heartbeat）
// 判断。有事在主线上发一条消息（Notices.post），硬线以下的开后台线去做，拿不准的进「任务 · 建议」；没事什么都不发。
// 计时用 tasks 的（登记进「定时」，每分钟看一眼）；在「定时」占一行，花名册里也有它；只能关，不能删。

import {
  type HeartbeatConfig,
  type HeartbeatView,
  type TeammateView,
  type TimedRowView,
  type UpdateHeartbeatRequest,
} from '../../shared/api/index.ts';
import { STANDING_PROJECT_IDS, type HeartbeatAct, type HeartbeatFact, type TimedSlot } from '../../shared/state.ts';
import type { NoticeInput } from '../attention/index.ts';
import { askJson } from '../brain/index.ts';
import type { TextModels } from '../kernel/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import type { StateService } from '../state/index.ts';
import { slotLast, zonedClock, type SuggestionInputDraft, type TimedProvider } from '../tasks/index.ts';
import { localDay } from '../daily/index.ts';
import { applyEdit, ChecklistError, DEFAULT_CONFIG, readConfig, replaceItems } from './checklist.ts';
import { collectFacts, freshFacts, type CalendarPort, type StalledPort } from './facts.ts';
import { EDIT_SYSTEM, EditOutputSchema, JUDGE_SYSTEM, judgeMaterial, JudgeOutputSchema, type JudgeOutput }
  from './judge.ts';

export const HEARTBEAT_SLOT_ID = 'heartbeat';
const MINUTE_MS = 60_000;
const NOTE_MAX_CHARS = 120;
const RECENT_BEATS = 5;

export type HeartbeatState = Pick<StateService, 'timedSlots' | 'heartbeatFacts' | 'transaction'>;

export interface HeartbeatOptions {
  state: HeartbeatState;
  now: () => Date;
  zone: () => string;
  /** null：没有模型可叫（测试、还没连模型）——有变化时记一句「没法判断」，下一跳再试。 */
  models: TextModels | null;
  /** 主线上一条消息 + 系统通知（attention/ 的 Notices.post）。 */
  notify: (input: NoticeInput) => boolean;
  /** 开一条后台线去做（做完贴回主线）。 */
  open: (input: { title: string; goal: string }) => string;
  suggest: (input: SuggestionInputDraft) => { created: boolean };
  calendar?: CalendarPort;
  stalled?: StalledPort;
  /** 定时的订阅和回顾里，本该出、过了一小时还没出的补一期；回补了哪几个（11-12：日报漏发心跳没发现）。 */
  catchUp?: (now: Date) => string[];
  changed?: () => void;
  newId: () => string;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text.trim().replace(/\s+/g, ' '));
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

function clockOf(at: Date, zone: string): string {
  return at.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** 现在是不是在安静时段里（可以跨午夜：23:00–08:00）。 */
export function inQuiet(at: Date, zone: string, from: string, to: string): boolean {
  const clock = clockOf(at, zone);
  return from > to ? clock >= from || clock < to : clock >= from && clock < to;
}

/** 安静时段结束的那一刻。 */
function quietEnd(at: Date, zone: string, from: string, to: string): Date {
  const today = localDay(at, zone);
  const end = zonedClock(today, to, zone);
  if (end.getTime() > at.getTime()) {
    return end;
  }
  const tomorrow = localDay(new Date(at.getTime() + 24 * 60 * MINUTE_MS), zone);
  return from > to ? zonedClock(tomorrow, to, zone) : end;
}

function seenOf(slot: TimedSlot): string[] {
  const seen = slot.memo['seen'];
  return Array.isArray(seen) ? seen.filter((key): key is string => typeof key === 'string') : [];
}

export class Heartbeat {
  readonly #options: HeartbeatOptions;
  #running: Promise<void> | null = null;

  constructor(options: HeartbeatOptions) {
    this.#options = options;
  }

  slot(): TimedSlot {
    return this.#options.state.timedSlots.ensure(HEARTBEAT_SLOT_ID, 'heartbeat', { ...DEFAULT_CONFIG });
  }

  config(): HeartbeatConfig {
    return readConfig(this.slot().config);
  }

  /** 每分钟一次（tasks 的计时器）：到点、不在安静时段、上一跳做完了，就跳一下。 */
  tick(now: Date): void {
    const { state } = this.#options;
    const slot = this.slot();
    if (!slot.enabled) {
      if (slot.nextAt !== null) {
        state.timedSlots.update(slot.id, slot.version, { nextAt: null });
      }
      return;
    }
    if (slot.nextAt !== null && Date.parse(slot.nextAt) > now.getTime()) {
      return;
    }
    if (this.#running !== null) {
      return;
    }
    const config = readConfig(slot.config);
    const zone = this.#options.zone();
    if (inQuiet(now, zone, config.quietFrom, config.quietTo)) {
      state.timedSlots.update(slot.id, slot.version,
        { nextAt: quietEnd(now, zone, config.quietFrom, config.quietTo).toISOString() });
      this.#changed();
      return;
    }
    state.timedSlots.update(slot.id, slot.version,
      { nextAt: new Date(now.getTime() + config.intervalMinutes * MINUTE_MS).toISOString() });
    this.#running = this.beat(now).catch((error: unknown) => {
      safeLog('error', 'heartbeat_failed', { category: errorCategory(error), error });
    }).finally(() => {
      this.#running = null;
    });
  }

  /** 等这一跳做完（测试、关服务）。 */
  async settled(): Promise<void> {
    await this.#running;
  }

  /** 跳一下：先比对，有新变化才叫模型。 */
  async beat(now: Date): Promise<void> {
    const { state } = this.#options;
    this.#catchUp(now);
    const zone = this.#options.zone();
    const config = this.config();
    const facts = collectFacts(config.items, { state, now, zone,
      ...(this.#options.calendar === undefined ? {} : { calendar: this.#options.calendar }),
      ...(this.#options.stalled === undefined ? {} : { stalled: this.#options.stalled }) });
    const fresh = freshFacts(facts, seenOf(this.slot()));
    const seen = facts.map((fact) => fact.key);
    if (fresh.length === 0) {
      this.#record({ at: now, outcome: 'quiet', note: '没事', seen });
      return;
    }
    const models = this.#options.models;
    if (models === null) {
      this.#fail(now, fresh, '还没连模型，没法判断；下一跳再看');
      return;
    }
    let output: JudgeOutput;
    try {
      output = await askJson({ models }, JudgeOutputSchema, JUDGE_SYSTEM,
        judgeMaterial(fresh, config.items, now.toISOString(), zone), AbortSignal.timeout(3 * MINUTE_MS), 'heartbeat');
    } catch (error) {
      safeLog('warn', 'heartbeat_judge_failed', { category: errorCategory(error) });
      this.#fail(now, fresh, `这次没判断成：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const did = this.#act(output, fresh, now);
    const note = this.#note(output, fresh, did);
    state.timedSlots.heartbeats.add({ at: now.toISOString(), found: fresh, did, note, failed: false });
    this.#record({ at: now, outcome: did.length === 0 ? 'quiet' : 'done', note, seen });
  }

  /** 漏发的定时补一期，告诉他一声，记一跳；补不补都不拦后面照常看。 */
  #catchUp(now: Date): void {
    let caught: string[];
    try {
      caught = this.#options.catchUp?.(now) ?? [];
    } catch (error) {
      safeLog('error', 'heartbeat_catch_up_failed', { category: errorCategory(error), error });
      return;
    }
    if (caught.length === 0) {
      return;
    }
    const text = `${caught.join('、')}没按时出，已补一期。`;
    const key = `heartbeat:catch-up:${now.toISOString()}`;
    this.#options.notify({ key, text, brief: clip(`心跳：${text}`, 60), url: '/#/' });
    this.#options.state.timedSlots.heartbeats.add({ at: now.toISOString(), found: [],
      did: [{ kind: 'notify', text: clip(text, 300), ref: key }], note: clip(text, NOTE_MAX_CHARS), failed: false });
  }

  #act(output: JudgeOutput, fresh: readonly HeartbeatFact[], now: Date): HeartbeatAct[] {
    const did: HeartbeatAct[] = [];
    const tell = output.tell?.trim() ?? '';
    if (tell !== '') {
      const key = `heartbeat:${now.toISOString()}`;
      this.#options.notify({ key, text: tell, brief: clip(output.brief ?? '心跳：有事要你看一眼', 60), url: '/#/' });
      did.push({ kind: 'notify', text: clip(tell, 300), ref: key });
    }
    for (const item of output.start ?? []) {
      if (item.title.trim() === '' || item.goal.trim() === '') {
        continue;
      }
      const lineId = this.#options.open({ title: clip(item.title, 120),
        goal: `心跳看到：${this.#refsText(item.refs, fresh)}\n要做的事：${item.goal}` });
      did.push({ kind: 'start', text: clip(item.title, 300), ref: lineId });
    }
    for (const item of output.suggest ?? []) {
      if (item.title.trim() === '' || item.why.trim() === '' || item.goal.trim() === '') {
        continue;
      }
      const refs = [...(item.refs ?? [])].sort().join('|');
      const key = clip(`heartbeat:${refs === '' ? item.title : refs}`, 200);
      const { created } = this.#options.suggest({ title: clip(item.title, 60), why: clip(item.why, 200),
        goal: item.goal, projectId: null, source: 'heartbeat', icon: 'sparkle', key, sourceRef: null });
      if (created) {
        did.push({ kind: 'suggest', text: clip(item.title, 300), ref: key });
      }
    }
    return did;
  }

  #refsText(refs: readonly string[] | undefined, fresh: readonly HeartbeatFact[]): string {
    const picked = fresh.filter((fact) => refs?.includes(fact.key) ?? false);
    return (picked.length === 0 ? fresh : picked).map((fact) => fact.text).join('；');
  }

  #note(output: JudgeOutput, fresh: readonly HeartbeatFact[], did: readonly HeartbeatAct[]): string {
    const head = output.note?.trim() || (did.length === 0 ? '没事' : fresh[0]?.text ?? '');
    const parts: string[] = [];
    if (did.some((act) => act.kind === 'notify')) {
      parts.push('发了消息给你');
    }
    const started = did.filter((act) => act.kind === 'start').length;
    if (started > 0) {
      parts.push(started === 1 ? `顺手开了一条线：${did.find((act) => act.kind === 'start')?.text ?? ''}`
        : `开了 ${started} 条线去做`);
    }
    const suggested = did.filter((act) => act.kind === 'suggest').length;
    if (suggested > 0) {
      parts.push(`放进「建议」${suggested} 条`);
    }
    return clip(parts.length === 0 ? head : `${head} → ${parts.join('，')}`, NOTE_MAX_CHARS);
  }

  #record(input: { at: Date; outcome: 'quiet' | 'done'; note: string; seen: string[] }): void {
    const { state } = this.#options;
    const slot = this.slot();
    state.timedSlots.update(slot.id, slot.version, { lastRunAt: input.at.toISOString(), lastOutcome: input.outcome,
      lastNote: input.note, memo: { ...slot.memo, seen: input.seen } });
    this.#changed();
  }

  /** 没判断成：这几件不算看过，下一跳还会再看到它们。 */
  #fail(at: Date, fresh: HeartbeatFact[], note: string): void {
    const { state } = this.#options;
    const short = clip(note, NOTE_MAX_CHARS);
    state.timedSlots.heartbeats.add({ at: at.toISOString(), found: fresh, did: [], note: short, failed: true });
    const slot = this.slot();
    state.timedSlots.update(slot.id, slot.version, { lastRunAt: at.toISOString(), lastOutcome: 'failed',
      lastNote: short });
    this.#changed();
  }

  // —— 设置（弹层） ——

  view(): HeartbeatView {
    const slot = this.slot();
    const beats = this.#options.state.timedSlots.heartbeats.recent(RECENT_BEATS)
      .map((beat) => ({ at: beat.at, note: beat.note, failed: beat.failed }));
    const quiet = slot.lastOutcome === 'quiet' && slot.lastRunAt !== null
      && (beats[0] === undefined || beats[0].at < slot.lastRunAt)
      ? [{ at: slot.lastRunAt, note: slot.lastNote ?? '没事', failed: false }] : [];
    return { enabled: slot.enabled, config: readConfig(slot.config), nextAt: slot.enabled ? slot.nextAt : null,
      recent: [...quiet, ...beats].slice(0, RECENT_BEATS) };
  }

  update(request: Omit<UpdateHeartbeatRequest, 'requestId'>): HeartbeatView {
    const { state } = this.#options;
    const slot = this.slot();
    const config = readConfig(slot.config);
    const next: HeartbeatConfig = {
      ...config,
      ...(request.intervalMinutes === undefined ? {} : { intervalMinutes: request.intervalMinutes }),
      ...(request.items === undefined ? {} : { items: replaceItems(config.items, request.items,
        this.#options.newId) }),
    };
    const nextAt = request.intervalMinutes === undefined || !slot.enabled ? slot.nextAt
      : new Date(this.#options.now().getTime() + next.intervalMinutes * MINUTE_MS).toISOString();
    state.timedSlots.update(slot.id, slot.version, { config: next, nextAt });
    this.#changed();
    return this.view();
  }

  /** 一句话改清单：模型给改法，代码校验后才落；没有模型就把这句当成新的一条。 */
  async say(text: string, signal: AbortSignal): Promise<HeartbeatView> {
    const config = this.config();
    const models = this.#options.models;
    let edit = { remove: [] as string[], add: [text.trim()] };
    if (models !== null) {
      const output = await askJson({ models }, EditOutputSchema, EDIT_SYSTEM, JSON.stringify({
        items: config.items.map((item) => ({ id: item.id, text: item.text })), said: text }), signal, 'heartbeat');
      edit = { remove: output.remove ?? [], add: (output.add ?? []).filter((item) => item.trim() !== '') };
    }
    if (edit.remove.length === 0 && edit.add.length === 0) {
      throw new ChecklistError('没听出要怎么改清单：说「加一条……」或「别再看……」。');
    }
    const items = applyEdit(config.items, edit, this.#options.newId);
    return this.update({ items: items.map((item) => ({ id: item.id, text: item.text })) });
  }

  setEnabled(on: boolean): void {
    const { state } = this.#options;
    const slot = this.slot();
    if (slot.enabled === on) {
      return;
    }
    state.timedSlots.update(slot.id, slot.version, { enabled: on,
      nextAt: on ? this.#options.now().toISOString() : null });
    this.#changed();
  }

  // —— 「定时」那一行和花名册 ——

  row(): TimedRowView {
    const slot = this.slot();
    const config = readConfig(slot.config);
    const every = config.intervalMinutes % 60 === 0 ? `每 ${config.intervalMinutes / 60} 小时`
      : `每 ${config.intervalMinutes} 分钟`;
    return {
      id: HEARTBEAT_SLOT_ID,
      source: 'heartbeat',
      title: '心跳',
      summary: `${every}看一眼 · ${config.quietFrom}–${config.quietTo} 不跳`,
      icon: 'pulse',
      hue: 'slate',
      nextAt: slot.enabled ? slot.nextAt : null,
      last: this.#running !== null ? { glyph: 'run', text: '在看' } : slotLast(slot, null, slot.enabled),
      enabled: slot.enabled,
      canToggle: true,
      canRemove: false,
      projectId: STANDING_PROJECT_IDS.personal,
      lineId: null,
      askId: null,
      teammateId: HEARTBEAT_SLOT_ID,
      sheet: true,
    };
  }

  provider(): TimedProvider {
    return {
      source: 'heartbeat',
      rows: () => [this.row()],
      teammates: (): TeammateView[] => {
        const row = this.row();
        const slot = this.slot();
        const at = slot.lastRunAt === null ? '' : `${clockOf(new Date(slot.lastRunAt), this.#options.zone())} `;
        const now = this.#running !== null ? '在看' : slot.lastRunAt === null ? '' : slot.lastOutcome === 'quiet'
          ? `${at}看过，${slot.lastNote ?? '没事'}` : `${at}${slot.lastNote ?? ''}`;
        return [{ id: HEARTBEAT_SLOT_ID, name: '心跳', icon: row.icon, hue: row.hue,
          glyph: row.last?.glyph ?? (row.enabled ? 'idle' : 'pause'), now, rowIds: [row.id], lineId: null,
          canStop: row.enabled }];
      },
      setEnabled: (_rowId, on) => this.setEnabled(on),
      tick: (now) => this.tick(now),
    };
  }

  #changed(): void {
    try {
      this.#options.changed?.();
    } catch (error) {
      safeLog('error', 'heartbeat_changed_hook_failed', { category: errorCategory(error) });
    }
  }
}
