// ?scene=relay（11-16 截图用）：主线把海投交给一位虚构队友。主线里只有他和主线的话（主线整理后回他）；
// 队友自己的对话里是「主线 → 队友」交代的话、那件事的卡片，和「队友 → 主线」交回的结论。全是虚构的人和事。

import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';
import type { FakeMates } from './fake-mates.ts';
import type { LineMessageView } from '../shared.ts';

type Draft = Omit<LineMessageView, 'lineId' | 'seq'>;

function message(fields: Partial<Draft> & { createdAt: string }): Draft {
  return { role: 'assistant', text: '', origin: null, thinking: null, thinkingMs: null, steps: [], toolCallId: null,
    tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null, attachments: [], widgets: [],
    ...fields };
}

export async function seedRelayScene({ mates, lines }: { mates: FakeMates; lines: FakeLines },
  now: Date): Promise<void> {
  const mate = await mates.create({ requestId: 'scene-relay-mate', name: '求职顾问', avatar: 'bob',
    hue: 'teal', role: '简历、投递和面试准备', soul: '', purpose: null });
  const at = (minutes: number): string => new Date(now.getTime() - minutes * 60_000).toISOString();
  const ask = '帮我在招聘网站上给本地的岗位打招呼，就用我给的这段话，今天 50 个。';
  const goal = '在已登录的招聘网站上给本地岗位打招呼，用他给的原文，今天目标 50 个；只打招呼，不发简历。';
  const result = '**今天打了 50 个招呼，都用的你给的原文。** 有 3 位已经回复，想看简历；没有遇到限额。';
  lines.record(MAIN_LINE_ID, message({ text: ask, role: 'user',
    origin: { kind: 'user', userText: ask }, createdAt: at(95) }));
  lines.record(MAIN_LINE_ID, message({ text: '交给求职顾问了，你接着忙你的。', createdAt: at(94) }));
  lines.record(MAIN_LINE_ID, message({
    text: '求职顾问那边做完了：**50 个招呼都发出去了**，有 3 位 HR 回复想看简历，要我把简历发给他们吗？',
    createdAt: at(10) }));
  const work = lines.blank('relay-work', 'background', `求职顾问 · ${goal.slice(0, 30)}`, { mateId: mate.id,
    parentLineId: MAIN_LINE_ID, handedOff: true, status: 'idle', outcome: 'done', createdAt: at(94),
    updatedAt: at(11) });
  lines.put(work);
  lines.record(mate.lineId, message({ text: goal, role: 'handoff',
    childLineId: work.id, relay: { from: { kind: 'main' }, to: { kind: 'mate', id: mate.id } }, createdAt: at(94) }));
  lines.record(mate.lineId, message({ text: result, role: 'lineReport', ok: true,
    stopReason: 'done', childLineId: work.id, relay: { from: { kind: 'mate', id: mate.id }, to: { kind: 'main' } },
    createdAt: at(11) }));
}
