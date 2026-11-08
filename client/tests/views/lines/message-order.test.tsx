import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LineInputOrigin, LineMessageView, LineView } from '../../../src/api/shared.ts';
import { applyLineEvent, EMPTY_THREAD, type LineThreadData } from '../../../src/views/lines/line-thread-data.ts';
import { buildTimeline } from '../../../src/views/lines/timeline.ts';
import { TurnView } from '../../../src/views/lines/turn-view.tsx';

const AT = '2026-11-07T00:00:10.000Z';

function message(seq: number, fields: Partial<LineMessageView> = {}): LineMessageView {
  return { lineId: 'line-main', seq, role: 'assistant', origin: null, text: '', thinking: null, thinkingMs: null,
    steps: [],
    toolCallId: null, tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null,
    attachments: [], widgets: [], createdAt: AT, ...fields };
}

function child(fields: Partial<LineView> = {}): LineView {
  return { id: 'child-one', kind: 'background', parentLineId: 'line-main', parentMessageSeq: null,
    projectId: null, title: '查资料',
    status: 'running', pauseReason: null, outcome: null, pausedUntil: null, failure: null, activity: null,
    activeSince: AT, queued: 0, lastAnswer: null, createdAt: AT, updatedAt: AT, ...fields };
}

const user = message(1, { role: 'user', text: '查一下', origin: { kind: 'user' },
  createdAt: '2026-11-07T00:00:00.000Z' });
const introduction = message(2, { text: '我先查原始资料。', stopReason: 'toolUse',
  steps: [{ toolCallId: 'start-one', tool: 'start_line', say: '查资料' }] });

describe('消息作者和原始顺序', () => {
  it('只有本人来源成为用户气泡；委派、系统和旧的未知输入留成中性记录', () => {
    const origins: (LineInputOrigin | null)[] = [{ kind: 'user' }, { kind: 'delegation' },
      { kind: 'system' }, { kind: 'trigger' }, { kind: 'network' }, null];
    const items = buildTimeline({ lineId: 'line-main', lines: [], summaries: new Map(),
      messages: origins.map((origin, index) => message(index + 1, { role: 'user', text: `输入 ${index}`, origin })) });
    expect(items.map((item) => item.kind)).toEqual(['user', 'input', 'input', 'input', 'input', 'input']);
  });

  it('同毫秒创建子线，发起说明先出现，子线卡在后', () => {
    const items = buildTimeline({ lineId: 'line-main', messages: [user, introduction], lines: [child()],
      summaries: new Map() });
    expect(items.map((item) => item.key)).toEqual(['m-1', 't-2', 'child-child-one']);
  });

  it('子线按真实发起消息定位，不因创建时间相等或时间偏差越过前后回复', () => {
    const final = message(3, { text: '可以接着聊。' });
    const items = buildTimeline({ lineId: 'line-main', messages: [user, introduction, final],
      lines: [child({ parentMessageSeq: 2, createdAt: user.createdAt })], summaries: new Map() });
    expect(items.map((item) => item.key)).toEqual(['m-1', 't-2', 'child-child-one', 't-3']);
  });

  it('子线状态先于父线消息补到时，等发起文字到达后再放卡，不抢到它前面', () => {
    const line = child({ parentMessageSeq: 2 });
    const pending = buildTimeline({ lineId: 'line-main', messages: [user], lines: [line], summaries: new Map() });
    expect(pending.map((item) => item.key)).toEqual(['m-1']);
    const loaded = buildTimeline({ lineId: 'line-main', messages: [user, introduction],
      lines: [line], summaries: new Map() });
    expect(loaded.map((item) => item.key)).toEqual(['m-1', 't-2', 'child-child-one']);
  });

  it('回报到达更新同一张子线卡，回报正文在新消息位置，卡的 key 和位置不改变', () => {
    const line = child({ parentMessageSeq: 2 });
    const messages = [user, introduction, message(3, { text: '可以接着聊。',
      createdAt: '2026-11-07T00:00:11.000Z' })];
    const before = buildTimeline({ lineId: 'line-main', messages, lines: [line], summaries: new Map() });
    const after = buildTimeline({ lineId: 'line-main', messages: [...messages,
      message(4, { role: 'lineReport', childLineId: line.id, text: '结果到了。', stopReason: 'done',
        createdAt: '2026-11-07T00:00:12.000Z' })],
    lines: [{ ...line, status: 'idle', outcome: 'done' }], summaries: new Map() });
    const key = 'child-child-one';
    expect(before.findIndex((item) => item.key === key)).toBe(2);
    expect(after.findIndex((item) => item.key === key)).toBe(2);
    expect(after.at(-1)).toMatchObject({ kind: 'report', message: { text: '结果到了。' } });
    expect(after.filter((item) => item.kind === 'child')).toHaveLength(1);
  });

  it('多段回复与过程保持顺序，结束后的过程不会跑到前一段文字上方', () => {
    const items = buildTimeline({ lineId: 'line-main', lines: [], summaries: new Map(), messages: [
      user,
      message(2, { text: '先看一手资料。', stopReason: 'toolUse',
        steps: [{ toolCallId: 'read', tool: 'note_read', say: '读原文' }] }),
      message(3, { role: 'toolResult', toolCallId: 'read', ok: true, text: '原文已读' }),
      message(4, { text: '找到关键段，再对照另一份。', stopReason: 'toolUse',
        steps: [{ toolCallId: 'compare', tool: 'note_read', say: '对照资料' }] }),
      message(5, { role: 'toolResult', toolCallId: 'compare', ok: true, text: '核对一致' }),
      message(6, { text: '两份来源一致。', stopReason: 'stop' }),
    ] });
    render(<>{items.map((item) => item.kind === 'turn'
      ? <TurnView key={item.key} lineId="line-main" turn={item} /> : null)}</>);
    const texts = [screen.getByText('先看一手资料。'), ...screen.getAllByRole('button', { name: '做了 1 步' }),
      screen.getByText('找到关键段，再对照另一份。'), screen.getByText('两份来源一致。')];
    const [first, firstStep, secondStep, middle, last] = texts as HTMLElement[];
    const before = (left: HTMLElement, right: HTMLElement): void => {
      expect(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    };
    before(first!, firstStep!);
    before(firstStep!, middle!);
    before(middle!, secondStep!);
    before(secondStep!, last!);
  });

  it('委派与本人待发文本相同也不能误认成本人的发送回执', () => {
    const data: LineThreadData = { ...EMPTY_THREAD, pending: [{ requestId: 'r-user', text: '同一段话',
      request: { text: '同一段话', quotes: [] }, attachments: [], status: 'sending', error: null }] };
    const delegated = applyLineEvent(data, 'line-main', { type: 'line_message',
      message: message(7, { role: 'user', text: '同一段话', origin: { kind: 'delegation' } }) });
    expect(delegated.pending).toHaveLength(1);
    const own = applyLineEvent(delegated, 'line-main', { type: 'line_message',
      message: message(8, { role: 'user', text: '同一段话', origin: { kind: 'user' } }) });
    expect(own.pending).toHaveLength(0);
  });
});
