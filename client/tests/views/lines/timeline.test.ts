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

describe('线的记录排成对话', () => {
  it('空间写入回执变成版本卡，失败回执不伪装成改好了', () => {
    const result = { id: 'sp-one', title: '整理稿', version: 2, change: '补了第二段', genre: 'report' };
    const good = msg({ role: 'toolResult', tool: 'space_edit', text: JSON.stringify(result), ok: true });
    const failed = msg({ role: 'toolResult', tool: 'space_write', text: JSON.stringify(result), ok: false });
    const timeline = buildTimeline({ lineId: 'line-main', messages: [good, failed], lines: [], summaries: new Map() });
    expect(lastTurn(timeline)?.parts.filter((part) => part.kind === 'space')).toEqual([
      { kind: 'space', seq: good.seq, result },
    ]);
  });
  it('两句话之间 Plasticine 的消息合成一轮：想了几秒、几步（结果一句）、回答', () => {
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

  it('停在某一步的结果上（做这一步时被叫停，服务端不记空的中止）：这一轮记成 endedOnTool', () => {
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

  it('步骤结束时服务端给的摘要优先；出错和叫停各记一笔', () => {
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

  it('后台线按发起位置保留卡片，后来的回报正文排在自己的位置', () => {
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

  it('结果一句只取第一行、过长截短', () => {
    expect(clipResult('\n  第一行  \n第二行')).toBe('第一行');
    expect(clipResult('字'.repeat(80))).toHaveLength(60);
  });
});

describe('线的事件改本地副本', () => {
  it('文字和思考一段段接上；回答写进库后流式的字收掉、待发的同一句收掉；线不在跑了整段收掉', () => {
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

  it('线的状态旧的不盖新的：叫停时推送的「空闲」先到，后到的「在跑」不算', () => {
    let data: LineThreadData = { ...EMPTY_THREAD, line: line({ id: 'line-main', kind: 'main', status: 'idle',
      updatedAt: '2026-11-05T10:01:00.000Z' }) };
    data = applyLineEvent(data, 'line-main', { type: 'line_changed', line: line({ id: 'line-main', kind: 'main',
      status: 'running', updatedAt: '2026-11-05T10:00:59.000Z' }) });
    expect(data.line?.status).toBe('idle');
    expect(newerLine(data.line, line({ id: 'line-main', status: 'running', updatedAt: '2026-11-05T10:00:58.000Z' }))
      .status).toBe('idle');
  });
});


describe('没内容的提醒不画', () => {
  it('正文是空的或字面上的 "null" 的提醒跳过（数据不动），别的照常', () => {
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
