// 卡出现在哪（11-16 卡片回到对话里）：出它的那段对话；沿交办的路往上每段都有；同一位队友的别的线在它自己的对话里；
// 后台来的出在主线；替你回朋友的卡不在线里画。卡按出卡时间插进对话，开着的卡不随着接着聊而消失。

import { describe, expect, it } from 'vitest';
import type { LineMessageView, LineView } from '../../../src/api/shared.ts';
import { asksForConversation, waitingIn } from '../../../src/views/asks/conversation-asks.ts';
import { buildTimeline } from '../../../src/views/lines/timeline.ts';
import { askView } from '../../api/http-fixtures.ts';

function line(fields: Partial<LineView> & { id: string }): LineView {
  return { kind: 'background', parentLineId: null, parentMessageSeq: null, projectId: null, title: '一件事',
    pauseReason: null, outcome: null, status: 'waiting', pausedUntil: null, failure: null, activity: null,
    activeSince: null, queued: 0, lastAnswer: null, createdAt: '2026-11-16T10:00:00.000Z',
    updatedAt: '2026-11-16T10:00:00.000Z', ...fields };
}

const MAIN = line({ id: 'line-main', kind: 'main', title: '主线', status: 'idle' });
const MATE = line({ id: 'line-mate', mateId: 'mate-jobs', title: '求职顾问' });
const HANDED = line({ id: 'line-handed', parentLineId: 'line-main', mateId: 'mate-jobs', handedOff: true,
  title: '海投打招呼' });
const GROUP = line({ id: 'line-group', mateGroupId: 'group-1', title: '求职小组' });
const GROUP_TASK = line({ id: 'line-gtask', parentLineId: 'line-group', mateId: 'mate-jobs', title: '投 3 份' });
const SCHEDULE = line({ id: 'line-schedule', title: '续火花' });
const LINES = [MAIN, MATE, HANDED, GROUP, GROUP_TASK, SCHEDULE];

const ask = (id: string, lineId: string | null, at: string, more: Parameters<typeof askView>[0] = {}) =>
  askView({ id, lineId, createdAt: at, ...more });

const ASKS = [
  ask('a-main', 'line-main', '2026-11-16T10:01:00.000Z'),
  ask('a-handed', 'line-handed', '2026-11-16T10:02:00.000Z'),
  ask('a-gtask', 'line-gtask', '2026-11-16T10:03:00.000Z'),
  ask('a-schedule', 'line-schedule', '2026-11-16T10:04:00.000Z'),
  ask('a-nowhere', null, '2026-11-16T10:05:00.000Z'),
  ask('a-chat', null, '2026-11-16T10:06:00.000Z', { networkReply: { contactId: 'c-1', groupId: null,
    questionId: 'q-1', draft: '好的' } }),
  ask('a-mate', 'line-mate', '2026-11-16T10:07:00.000Z'),
];

const ids = (lineView: LineView): string[] =>
  asksForConversation(lineView, LINES, ASKS).map((placed) => placed.ask.id);

describe('一段对话里画哪些卡', () => {
  it('主线：自己的、交给队友的、后台来的；不画队友自己对话里的、群组里的、替你回朋友的', () => {
    expect(ids(MAIN)).toEqual(['a-main', 'a-handed', 'a-schedule', 'a-nowhere']);
    const relayed = asksForConversation(MAIN, LINES, ASKS).find((placed) => placed.ask.id === 'a-handed');
    expect(relayed?.from?.id).toBe('line-handed');
  });

  it('队友自己的对话：自己的、交给它的（主线派的、群组任务）都有', () => {
    expect(ids(MATE)).toEqual(['a-handed', 'a-gtask', 'a-mate']);
  });

  it('群组：群组任务的卡在群组里', () => {
    expect(ids(GROUP)).toEqual(['a-gtask']);
  });

  it('输入框上方只数开着、没先不的', () => {
    const placed = asksForConversation(MAIN, LINES, [...ASKS.slice(0, 2),
      ask('a-deferred', 'line-main', '2026-11-16T10:08:00.000Z', { deferredAt: '2026-11-16T10:09:00.000Z' }),
      ask('a-done', 'line-main', '2026-11-16T10:09:00.000Z', { status: 'answered' })]);
    expect(waitingIn(placed).map((item) => item.id)).toEqual(['a-main', 'a-handed']);
  });
});

describe('卡按出卡时间插进对话', () => {
  it('卡在出它的那一步后面；之后接着聊，卡还在原处', () => {
    let seq = 0;
    const msg = (fields: Partial<LineMessageView>): LineMessageView => {
      seq += 1;
      return { lineId: 'line-main', seq, role: 'assistant', origin: fields.role === 'user' ? { kind: 'user' } : null,
        text: '', thinking: null, thinkingMs: null, steps: [], toolCallId: null, tool: null, say: null, ok: null,
        summary: null, stopReason: null, childLineId: null, attachments: [], widgets: [],
        createdAt: '2026-11-16T10:00:00.000Z', ...fields };
    };
    const messages = [
      msg({ role: 'user', text: '海投 3 份', createdAt: '2026-11-16T10:00:00.000Z' }),
      msg({ stopReason: 'toolUse', createdAt: '2026-11-16T10:00:30.000Z',
        steps: [{ toolCallId: 'c1', tool: 'page_send', say: '发招呼' }] }),
      msg({ role: 'user', text: '公众号呢？', createdAt: '2026-11-16T10:03:00.000Z' }),
      msg({ text: '草稿存好了。', stopReason: 'stop', createdAt: '2026-11-16T10:03:10.000Z' }),
    ];
    const asks = asksForConversation(MAIN, LINES, [ask('a-main', 'line-main', '2026-11-16T10:01:00.000Z')]);
    const items = buildTimeline({ lineId: 'line-main', messages, lines: LINES, summaries: new Map(), asks });
    expect(items.map((item) => item.kind)).toEqual(['user', 'turn', 'ask', 'user', 'turn']);
  });
});
