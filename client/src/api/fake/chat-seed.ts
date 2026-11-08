// 八项修复的演示数据：真实线接口与组件，覆盖多段正文、过程、固定任务卡和委派身份。?scene=chat。

import type { LineMessageView } from '../shared.ts';
import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';

function message(at: Date, fields: Partial<LineMessageView>): Omit<LineMessageView, 'lineId' | 'seq'> {
  return { role: 'assistant', origin: null, text: '', thinking: null, thinkingMs: null, steps: [],
    toolCallId: null, tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null,
    attachments: [], widgets: [], createdAt: at.toISOString(), ...fields };
}

export function seedChat(lines: FakeLines, now: Date): void {
  const at = (seconds: number): Date => new Date(now.getTime() - (150 - seconds) * 1000);
  const text = '查一下引用功能，顺便核对任务消息的顺序。';
  lines.record(MAIN_LINE_ID, message(at(0), { role: 'user', text }), { kind: 'user', userText: text });
  const source = lines.record(MAIN_LINE_ID, message(at(3), {
    text: '我先核对消息顺序，再检查选文引用。资料比对已经交给后台继续。', stopReason: 'toolUse',
    steps: [{ toolCallId: 'chat-read', tool: 'note_read', say: '核对消息来源' },
      { toolCallId: 'chat-start', tool: 'start_line', say: '核对对话记录' }],
  }));
  const childId = 'line-chat-check';
  lines.put(lines.blank(childId, 'background', '核对对话记录', { parentLineId: MAIN_LINE_ID,
    parentMessageSeq: source.seq, status: 'idle', outcome: 'done', createdAt: at(3).toISOString(),
    updatedAt: at(30).toISOString(), lastAnswer: '来源与顺序已核对。' }));
  lines.record(childId, message(at(3), { role: 'user', text: '逐条核对来源、发起消息与回报位置。' }),
    { kind: 'delegation', ref: `line:${MAIN_LINE_ID}:${source.seq}` });
  lines.record(childId, message(at(4), { steps: [
    { toolCallId: 'chat-child-read', tool: 'note_read', say: '对照原始消息' },
  ], stopReason: 'toolUse' }));
  lines.record(childId, message(at(25), { role: 'toolResult', tool: 'note_read', toolCallId: 'chat-child-read',
    text: '来源与顺序一致', summary: '来源与顺序一致', ok: true }));
  lines.record(childId, message(at(30), { text: '来源与顺序已核对。', stopReason: 'stop' }));
  lines.record(MAIN_LINE_ID, message(at(5), { role: 'toolResult', tool: 'note_read', toolCallId: 'chat-read',
    text: '本人输入与委派已区分', summary: '本人输入与委派已区分', ok: true }));
  lines.record(MAIN_LINE_ID, message(at(8), { role: 'user', text: '继续检查选文引用，并保留输入框里的草稿。' }),
    { kind: 'delegation' });
  lines.record(MAIN_LINE_ID, message(at(10), {
    text: '顺序已经对齐。接着确认选中文字是否保留原有草稿。', stopReason: 'toolUse',
    steps: [{ toolCallId: 'chat-quote', tool: 'note_read', say: '检查选文引用' }],
  }));
  lines.record(MAIN_LINE_ID, message(at(20), { role: 'toolResult', tool: 'note_read', toolCallId: 'chat-quote',
    text: '选文进入引用片，草稿保留', summary: '选文进入引用片，草稿保留', ok: true }));
  lines.record(MAIN_LINE_ID, message(at(31), { role: 'lineReport', childLineId: childId, stopReason: 'done',
    text: '记录已核对：回复、任务和后续结果都按原始顺序保留。' }));
  // 中文标点后紧跟中文的加粗（走查 11-07）：照样加粗，消息列表的预览里不露星号。
  const answer = '**定时提醒还没建成，也没有发出任何消息。**引用只带选中的原文，输入框里的草稿会保留。';
  lines.record(MAIN_LINE_ID, message(at(35), { stopReason: 'stop', text: answer }));
  // 系统发在主线上的通知（《优化清单》第 12 条）。
  lines.notice('项目「资料交接」过了截止日（10 月 30 日）还没完成：看是改截止还是接着推进。', '有项目过了截止日');
  lines.change(MAIN_LINE_ID, { status: 'idle', outcome: 'done', activity: null, activeSince: null,
    lastAnswer: answer });
}
