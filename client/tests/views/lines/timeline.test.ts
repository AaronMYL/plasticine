import { describe, expect, it } from 'vitest';
import type { LineMessageView, LineView } from '../../../src/api/shared.ts';
import { applyLineEvent, EMPTY_THREAD, type LineThreadData } from '../../../src/views/lines/line-thread-data.ts';
import { newerLine } from '../../../src/views/lines/line-store.ts';
import { buildTimeline, clipResult, lastTurn } from '../../../src/views/lines/timeline.ts';

let seq = 0;
function msg(fields: Partial<LineMessageView>): LineMessageView {
  seq += 1;
  return { lineId: 'line-main', seq, role: 'assistant', origin: fields.role === 'user' ? { kind: 'user' } : null,
    text: '', thinking: null, thinkingMs: null, steps: [],
    toolCallId: null, tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null,
    attachments: [], widgets: [], createdAt: `2026-11-05T10:00:${String(seq).padStart(2, '0')}.000Z`, ...fields };
}

function line(fields: Partial<LineView>): LineView {
  return { id: 'line-x', kind: 'background', parentLineId: 'line-main', parentMessageSeq: null,
    projectId: null, title: '查来源',
    pauseReason: null, outcome: null,
    status: 'running', pausedUntil: null, failure: null, activity: '读发布页…', activeSince: null, queued: 0,
    lastAnswer: null, createdAt: '2026-11-05T10:00:30.000Z', updatedAt: '2026-11-05T10:00:30.000Z', ...fields };
}

describe('Thread records arranged as conversation', () => {
  it('space write receipt renders as version card; failed receipt does not pose as saved', () => {
    const result = { id: 'sp-one', title: '整理稿', version: 2, change: '补了第二段', genre: 'report' };
    const good = msg({ role: 'toolResult', tool: 'space_edit', text: JSON.stringify(result), ok: true });
    const failed = msg({ role: 'toolResult', tool: 'space_write', text: JSON.stringify(result), ok: false });
    const timeline = buildTimeline({ lineId: 'line-main', messages: [good, failed], lines: [], summaries: new Map() });
    expect(lastTurn(timeline)?.parts.filter((part) => part.kind === 'space')).toEqual([
      { kind: 'space', seq: good.seq, result },
    ]);
  });
  it('groups Plasticine messages between user turns into thinking seconds, steps summary, and reply', () => {
    seq = 0;
    const messages = [
      msg({ role: 'user', text: '帮我查一下', createdAt: '2026-11-05T10:00:00.000Z' }),
      msg({ thinking: '先看签名', createdAt: '2026-11-05T10:00:12.000Z', stopReason: 'toolUse',
        steps: [{ toolCallId: 'c1', tool: 'device_action', say: '在 Mac 上验证签名' },
          { toolCallId: 'c2', tool: 'start_line', say: '开条线' }] }),
      msg({ role: 'toolResult', toolCallId: 'c1', text: 'Cua AI, Inc.\n签名有效', ok: true }),
      msg({ text: '是 Cua 的驱动。', stopReason: 'stop' }),
    ];
    const items = buildTimeline({ lineId: 'line-main', messages, lines: [], summaries: new Map() });
    expect(items.map((item) => item.kind)).toEqual(['user', 'turn']);
    const turn = lastTurn(items);
    expect(turn?.thinkingSeconds).toBe(12);
    expect(turn?.steps).toEqual([{ toolCallId: 'c1', tool: 'device_action', say: '在 Mac 上验证签名',
      result: 'Cua AI, Inc.', ok: true }]);
    expect(turn?.answers).toEqual(['是 Cua 的驱动。']);
  });

  it('turn stopped on a tool step without empty abort records endedOnTool', () => {
    seq = 0;
    const messages = [
      msg({ role: 'user', text: '再查一下' }),
      msg({ stopReason: 'toolUse', steps: [{ toolCallId: 's1', tool: 'slow', say: '慢慢做：查' }] }),
      msg({ role: 'toolResult', toolCallId: 's1', text: '叫停了', ok: false }),
    ];
    const cut = lastTurn(buildTimeline({ lineId: 'line-main', messages, lines: [], summaries: new Map() }));
    expect(cut?.endedOnTool).toBe(true);
    const done = lastTurn(buildTimeline({ lineId: 'line-main', lines: [], summaries: new Map(),
      messages: [...messages, msg({ text: '查完了', stopReason: 'stop' })] }));
    expect(done?.endedOnTool).toBe(false);
  });

  it('prefers server step-end summary and records error and stop entries separately', () => {
    seq = 0;
    const messages = [
      msg({ steps: [{ toolCallId: 'c1', tool: 'cloud_browser_open', say: '搜「Cua」' }] }),
      msg({ role: 'toolResult', toolCallId: 'c1', text: '很长的网页原文……', ok: true }),
      msg({ stopReason: 'error', text: '连不上模型，已重试 3 次' }),
    ];
    const summaries = new Map([['c1', '官方 GitHub 在第一条']]);
    const turn = lastTurn(buildTimeline({ lineId: 'line-main', messages, lines: [], summaries }));
    expect(turn?.steps[0]?.result).toBe('官方 GitHub 在第一条');
    expect(turn?.error).toBe('连不上模型，已重试 3 次');
    const stopped = lastTurn(buildTimeline({ lineId: 'line-main', messages: [msg({ stopReason: 'aborted' })],
      lines: [], summaries: new Map() }));
    expect(stopped?.stopped).toBe(true);
  });

  it('background thread keeps card at launch slot while later report body renders at its own slot', () => {
    seq = 0;
    const messages = [
      msg({ role: 'user', text: '慢慢查', createdAt: '2026-11-05T10:00:10.000Z' }),
      msg({ role: 'lineReport', childLineId: 'line-done', text: '只有一个。', createdAt: '2026-11-05T10:00:50.000Z' }),
    ];
    const lines = [line({ id: 'line-run', createdAt: '2026-11-05T10:00:20.000Z' }),
      line({ id: 'line-done', status: 'idle', createdAt: '2026-11-05T10:00:15.000Z' }),
      line({ id: 'line-other', parentLineId: 'line-elsewhere' })];
    const items = buildTimeline({ lineId: 'line-main', messages, lines, summaries: new Map() });
    expect(items.map((item) => item.key)).toEqual(['m-1', 'child-line-done', 'child-line-run', 'm-2']);
    expect(items[3]).toMatchObject({ kind: 'report', line: { id: 'line-done' } });
  });

  it('one-line result takes only first line and truncates when too long', () => {
    expect(clipResult('\n  第一行  \n第二行')).toBe('第一行');
    expect(clipResult('字'.repeat(80))).toHaveLength(60);
  });
});

describe('Thread events update local copy', () => {
  it('streams text and thinking, clears streaming and pending copy on persist, and clears when idle', () => {
    let data: LineThreadData = { ...EMPTY_THREAD, pending: [{ requestId: 'r1', text: '你好',
      request: { text: '你好', quotes: [] }, attachments: [], status: 'sending', error: null }] };
    data = applyLineEvent(data, 'line-main', { type: 'line_thinking', lineId: 'line-main', delta: '想' });
    data = applyLineEvent(data, 'line-main', { type: 'line_text', lineId: 'line-main', delta: '你' });
    data = applyLineEvent(data, 'line-main', { type: 'line_text', lineId: 'line-main', delta: '好' });
    data = applyLineEvent(data, 'line-main', { type: 'line_text', lineId: 'line-other', delta: '别的线' });
    expect(data.live).toMatchObject({ thinking: '想', text: '你好' });
    data = applyLineEvent(data, 'line-main', { type: 'line_message',
      message: { ...msg({ role: 'user', text: '你好' }) } });
    expect(data.pending).toEqual([]);
    data = applyLineEvent(data, 'line-main', { type: 'line_tool', lineId: 'line-main', phase: 'ended',
      toolCallId: 'c9', tool: 'note_read', say: '读笔记', ok: true, summary: '读完了', durationMs: 20 });
    expect(data.summaries.get('c9')).toBe('读完了');
    data = applyLineEvent(data, 'line-main', { type: 'line_message', message: msg({ text: '你好' }) });
    expect(data.live).toMatchObject({ text: '', thinking: '' });
    data = applyLineEvent(data, 'line-main', { type: 'line_changed', line: line({ id: 'line-main', kind: 'main',
      status: 'idle' }) });
    expect(data.live).toBeNull();
    data = applyLineEvent(data, 'line-main', { type: 'line_queue', lineId: 'line-main', queue: [] });
    expect(data.queue).toEqual([]);
  });

  it('older thread status never overwrites newer: idle on stop ignores later stale running event', () => {
    let data: LineThreadData = { ...EMPTY_THREAD, line: line({ id: 'line-main', kind: 'main', status: 'idle',
      updatedAt: '2026-11-05T10:01:00.000Z' }) };
    data = applyLineEvent(data, 'line-main', { type: 'line_changed', line: line({ id: 'line-main', kind: 'main',
      status: 'running', updatedAt: '2026-11-05T10:00:59.000Z' }) });
    expect(data.line?.status).toBe('idle');
    expect(newerLine(data.line, line({ id: 'line-main', status: 'running', updatedAt: '2026-11-05T10:00:58.000Z' }))
      .status).toBe('idle');
  });
});

describe('Empty reminders are not rendered', () => {
  it('skips reminders with empty or literal null body without mutating data while keeping others', () => {
    seq = 0;
    const messages = [
      msg({ role: 'notice', text: 'null' }),
      msg({ role: 'notice', text: '  ' }),
      msg({ role: 'notice', text: '后台线做完了' }),
    ];
    const items = buildTimeline({ lineId: 'line-main', messages, lines: [], summaries: new Map() });
    expect(items.map((item) => item.kind)).toEqual(['notice']);
  });
});
