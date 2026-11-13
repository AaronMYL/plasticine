// 队友和主线头像的状态（11-13 Aaron 看过设计稿「队友头像 · 设计稿」定）：线的状态加上这一刻在做的那一步（在想、
// 调哪个工具、写回答），换成头像的一种状态；一位队友（或主线）同时有几条线时按轻重取一个。纯函数，界面和测试共用。

import type { LineView } from '../../../api/shared.ts';

export const BOT_STATES = ['idle', 'queued', 'thinking', 'searching', 'reading', 'writing', 'working', 'sending',
  'composing', 'waiting', 'failed', 'paused', 'done'] as const;
export type BotState = (typeof BOT_STATES)[number];

/**
 * 每种状态在角色引擎里叫什么，动不动。空闲、暂停只画一张静止的；做完是一下子的（弹一下、撒把彩纸），之后静止。
 */
export const BOT_LOOK: Readonly<Record<BotState, { engine: string; moving: boolean }>> = {
  idle: { engine: 'idle', moving: false },
  queued: { engine: 'loading', moving: true },
  thinking: { engine: 'thinking', moving: true },
  searching: { engine: 'searching', moving: true },
  reading: { engine: 'reading', moving: true },
  writing: { engine: 'writing', moving: true },
  working: { engine: 'working', moving: true },
  sending: { engine: 'sending', moving: true },
  composing: { engine: 'composing', moving: true },
  waiting: { engine: 'waiting', moving: true },
  failed: { engine: 'alerting', moving: true },
  paused: { engine: 'powering-down', moving: false },
  done: { engine: 'idle', moving: false },
};

/** 一条在跑的线这一刻在做的那一步，从 line_thinking / line_tool / line_text 事件来。 */
export interface LinePulse {
  phase: 'thinking' | 'tool' | 'text';
  tool: string | null;
}

/** 做完之后这么久之内算「刚做完」（撒彩纸）；再晚就是空闲，翻回来看不会再撒一次。 */
export const DONE_FLASH_MS = 4_000;

/**
 * 工具名换成在做什么：按顺序找关键字，先到先得；都不像就是「动手」。工具名是 Plasticine 自己的（note_search、
 * cloud_browser_act、mate_handoff……），技能和外接的工具名也大多照这个叫法。
 */
const TOOL_RULES: readonly [RegExp, BotState][] = [
  [/ask_user|submit_ask/, 'waiting'],
  [/send|tell_line|start_line|handoff|task_card|message|network|outbound|reply/, 'sending'],
  [/search|browser_open|find|lookup/, 'searching'],
  [/write|append|edit|update|create|remember|forget|propose|change|file_to|todo|annotat/, 'writing'],
  [/read|fetch|observe|text|list|get_|inbox|book|note|memory|project|video|skill|page/, 'reading'],
];

export function stateForTool(tool: string): BotState {
  const name = tool.toLowerCase();
  return TOOL_RULES.find(([rule]) => rule.test(name))?.[1] ?? 'working';
}

export function lineState(line: LineView, pulse: LinePulse | undefined, now: number): BotState {
  switch (line.status) {
    case 'failed': return 'failed';
    case 'waiting': return 'waiting';
    case 'paused': return 'paused';
    case 'queued': return 'queued';
    case 'running':
      if (pulse === undefined || pulse.phase === 'thinking') return 'thinking';
      return pulse.phase === 'text' ? 'composing' : stateForTool(pulse.tool ?? '');
    case 'idle': {
      const recent = now - Date.parse(line.updatedAt) < DONE_FLASH_MS;
      return line.outcome === 'done' && line.unmet == null && recent ? 'done' : 'idle';
    }
  }
}

/** 几条线取一个：出错 > 等你 > 在做 > 排队 > 刚做完 > 暂停 > 空闲；同一档取最近动过的那条。 */
const RANK: Readonly<Record<BotState, number>> = {
  failed: 6, waiting: 5, thinking: 4, searching: 4, reading: 4, writing: 4, working: 4, sending: 4, composing: 4,
  queued: 3, done: 2, paused: 1, idle: 0,
};

export function combinedState(lines: readonly LineView[], pulses: ReadonlyMap<string, LinePulse>,
  now: number): BotState {
  let best: BotState = 'idle';
  let bestAt = '';
  for (const line of lines) {
    const state = lineState(line, pulses.get(line.id), now);
    if (RANK[state] > RANK[best] || (RANK[state] === RANK[best] && line.updatedAt > bestAt)) {
      best = state;
      bestAt = line.updatedAt;
    }
  }
  return best;
}

/** 一位队友的线：它自己的对话，加上交给它的后台事。 */
export function mateLines(lines: readonly LineView[], mate: { id: string; lineId: string }): LineView[] {
  return lines.filter((line) => line.id === mate.lineId || (line.kind === 'background' && line.mateId === mate.id));
}

/** 主线的线：主对话，加上不属于任何队友、群组的后台事（例行的心跳、做梦、研究员也在这里）。 */
export function mainLines(lines: readonly LineView[]): LineView[] {
  return lines.filter((line) => line.kind === 'main'
    || (line.kind === 'background' && line.mateId == null && line.mateGroupId == null));
}
