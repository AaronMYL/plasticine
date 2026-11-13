// 队友、主线头像的状态（11-13 设计稿）：线的状态和这一刻的那一步换成头像状态；几条线按轻重取一个。

import { describe, expect, it } from 'vitest';
import type { LineStreamEvent, LineView } from '../../../../src/api/shared.ts';
import { combinedState, DONE_FLASH_MS, lineState, mainLines, mateLines, stateForTool, type LinePulse }
  from '../../../../src/views/mates/bot/bot-state.ts';
import { nextPulse } from '../../../../src/views/lines/line-store.ts';

const NOW = Date.parse('2026-11-13T10:00:00.000Z');
const at = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

function line(id: string, fields: Partial<LineView> = {}): LineView {
  return { id, kind: 'background', parentLineId: null, parentMessageSeq: null, projectId: null, title: id,
    status: 'idle', pauseReason: null, outcome: null, pausedUntil: null, failure: null, activity: null,
    activeSince: null, queued: 0, lastAnswer: null, createdAt: at(60_000), updatedAt: at(60_000), ...fields };
}

describe('工具名换成在做什么', () => {
  it.each([
    ['note_search', 'searching'], ['conversation_search', 'searching'], ['cloud_browser_open', 'searching'],
    ['note_read', 'reading'], ['read_inbox', 'reading'], ['cloud_browser_observe', 'reading'],
    ['note_append', 'writing'], ['remember', 'writing'], ['edit_project_todo', 'writing'], ['skill_write', 'writing'],
    ['cloud_ssh_run', 'working'], ['cloud_browser_act', 'working'], ['device_action', 'working'],
    ['mate_handoff', 'sending'], ['send_task_card', 'sending'], ['schedule_send', 'sending'],
    ['ask_user', 'waiting'], ['some_unknown_tool', 'working'],
  ])('%s → %s', (tool, state) => {
    expect(stateForTool(tool)).toBe(state);
  });
});

describe('一条线', () => {
  it('在跑：按这一步；还没有事件就是在想', () => {
    const running = line('a', { status: 'running' });
    expect(lineState(running, undefined, NOW)).toBe('thinking');
    expect(lineState(running, { phase: 'text', tool: null }, NOW)).toBe('composing');
    expect(lineState(running, { phase: 'tool', tool: 'note_read' }, NOW)).toBe('reading');
  });

  it('排队、等你、暂停、出错各是各的', () => {
    expect(lineState(line('a', { status: 'queued' }), undefined, NOW)).toBe('queued');
    expect(lineState(line('a', { status: 'waiting' }), undefined, NOW)).toBe('waiting');
    expect(lineState(line('a', { status: 'paused' }), undefined, NOW)).toBe('paused');
    expect(lineState(line('a', { status: 'failed' }), undefined, NOW)).toBe('failed');
  });

  it('刚做完的才算做完；早做完的、停掉的、自己说没做成的都是空闲', () => {
    expect(lineState(line('a', { outcome: 'done', updatedAt: at(500) }), undefined, NOW)).toBe('done');
    expect(lineState(line('a', { outcome: 'done', updatedAt: at(DONE_FLASH_MS + 1) }), undefined, NOW)).toBe('idle');
    expect(lineState(line('a', { outcome: 'stopped', updatedAt: at(500) }), undefined, NOW)).toBe('idle');
    expect(lineState(line('a', { outcome: 'done', unmet: '没找到', updatedAt: at(500) }), undefined, NOW))
      .toBe('idle');
  });
});

describe('几条线合起来', () => {
  const pulses = new Map<string, LinePulse>([['b', { phase: 'tool', tool: 'note_search' }]]);

  it('出错 > 等你 > 在做 > 排队 > 暂停 > 空闲', () => {
    const lines = [line('a', { status: 'paused' }), line('b', { status: 'running' }), line('c', { status: 'queued' })];
    expect(combinedState(lines, pulses, NOW)).toBe('searching');
    expect(combinedState([...lines, line('d', { status: 'waiting' })], pulses, NOW)).toBe('waiting');
    expect(combinedState([...lines, line('e', { status: 'failed' })], pulses, NOW)).toBe('failed');
    expect(combinedState([line('a', { status: 'paused' })], pulses, NOW)).toBe('paused');
    expect(combinedState([], pulses, NOW)).toBe('idle');
  });

  it('同时在做几件，取最近动过的那条', () => {
    const lines = [line('b', { status: 'running', updatedAt: at(9_000) }),
      line('x', { status: 'running', updatedAt: at(1_000) })];
    const both = new Map<string, LinePulse>([...pulses, ['x', { phase: 'text', tool: null }]]);
    expect(combinedState(lines, both, NOW)).toBe('composing');
  });

  it('队友算它自己的对话和交给它的后台事；主线算主对话和不属于队友、群组的后台事', () => {
    const lines = [line('main', { kind: 'main' }), line('own', { kind: 'side', mateId: 'm1' }),
      line('job', { mateId: 'm1' }), line('other', { mateId: 'm2' }), line('group', { mateGroupId: 'g1' }),
      line('heartbeat')];
    expect(mateLines(lines, { id: 'm1', lineId: 'own' }).map((item) => item.id)).toEqual(['own', 'job']);
    expect(mainLines(lines).map((item) => item.id)).toEqual(['main', 'heartbeat']);
  });
});

describe('这一刻的那一步', () => {
  const tool = (phase: 'started' | 'ended', name: string): LineStreamEvent => ({ type: 'line_tool', lineId: 'a',
    phase, toolCallId: 't1', tool: name, say: '', ok: null, summary: null, durationMs: null });

  it('想 → 调工具 → 工具完了接着想 → 写回答；不在跑了就拿掉', () => {
    let pulses = nextPulse(new Map(), { type: 'line_thinking', lineId: 'a', delta: '想' });
    expect(pulses.get('a')).toEqual({ phase: 'thinking', tool: null });
    pulses = nextPulse(pulses, tool('started', 'note_read'));
    expect(pulses.get('a')).toEqual({ phase: 'tool', tool: 'note_read' });
    pulses = nextPulse(pulses, tool('ended', 'note_read'));
    expect(pulses.get('a')?.phase).toBe('thinking');
    pulses = nextPulse(pulses, { type: 'line_text', lineId: 'a', delta: '好' });
    const same = nextPulse(pulses, { type: 'line_text', lineId: 'a', delta: '的' });
    expect(same).toBe(pulses);
    pulses = nextPulse(pulses, { type: 'line_changed', line: line('a', { status: 'idle' }) });
    expect(pulses.has('a')).toBe(false);
  });
});
