import type { LineView } from '../../../api/shared.ts';

export const BOT_STATES = ['idle', 'queued', 'thinking', 'searching', 'reading', 'writing', 'working', 'sending',
  'composing', 'waiting', 'failed', 'paused', 'done'] as const;
export type BotState = (typeof BOT_STATES)[number];

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

export interface LinePulse {
  phase: 'thinking' | 'tool' | 'text';
  tool: string | null;
}

export const DONE_FLASH_MS = 4_000;

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

export function mateLines(lines: readonly LineView[], mate: { id: string; lineId: string }): LineView[] {
  return lines.filter((line) => line.id === mate.lineId || (line.kind === 'background' && line.mateId === mate.id));
}

export function mainLines(lines: readonly LineView[]): LineView[] {
  return lines.filter((line) => line.kind === 'main'
    || (line.kind === 'background' && line.mateId == null && line.mateGroupId == null));
}
