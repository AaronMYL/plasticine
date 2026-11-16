// ?scene=asks（11-16 卡片回到对话里截图用）：主线把海投交给一位虚构队友，队友点发送时要授权——卡在队友对话里、
// 主线里都有；一条后台定时线要确认一张卡，出在主线；早先一张在「等你」里答过的收成一行；之后他接着聊。
// 全是虚构的人和事。

import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';
import type { FakeAsks } from './fake-asks.ts';
import type { FakeMates } from './fake-mates.ts';
import type { LineMessageView } from '../shared.ts';

type Draft = Omit<LineMessageView, 'lineId' | 'seq'>;

function message(fields: Partial<Draft> & { createdAt: string }): Draft {
  return { role: 'assistant', text: '', origin: null, thinking: null, thinkingMs: null, steps: [], toolCallId: null,
    tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null, attachments: [], widgets: [],
    ...fields };
}

function user(text: string, createdAt: string): Draft {
  return message({ text, role: 'user', origin: { kind: 'user', userText: text }, createdAt });
}

export async function seedAsksScene({ mates, lines, asks }: { mates: FakeMates; lines: FakeLines; asks: FakeAsks },
  now: Date): Promise<void> {
  const at = (minutes: number): string => new Date(now.getTime() - minutes * 60_000).toISOString();
  const mate = await mates.create({ requestId: 'scene-asks-mate', name: '求职顾问', avatar: 'bob',
    hue: 'teal', role: '简历、投递和面试准备', soul: '', purpose: null });
  lines.record(MAIN_LINE_ID, user('周报的收件人照上周的来。', at(60)));
  lines.record(MAIN_LINE_ID, message({ text: '好，照上周的发。', createdAt: at(59) }));
  const weekly = asks.raise({ id: 'scene-ask-weekly', kind: 'decide', lineId: MAIN_LINE_ID,
    question: '周报发给组里还是只发老板？', createdAt: at(58),
    options: [{ id: 'team', label: '发给组里', recommended: true, description: null },
      { id: 'boss', label: '只发老板', recommended: false, description: null }] });
  asks.answerElsewhere(weekly.id, 'team', undefined, { kind: 'wait' });
  lines.record(MAIN_LINE_ID, user('海投先定 3 份，用我给的那段话。', at(30)));
  lines.record(MAIN_LINE_ID, message({ text: '交给求职顾问去投。', createdAt: at(29) }));
  const work = lines.blank('scene-asks-work', 'background', '海投打招呼 3 份', { mateId: mate.id,
    parentLineId: MAIN_LINE_ID, handedOff: true, status: 'waiting', createdAt: at(29), updatedAt: at(20) });
  lines.put(work);
  lines.record(mate.lineId, message({ text: '海投先定 3 份：只投本地的产品岗，用他给的原文；联系过的不重发。',
    role: 'handoff', childLineId: work.id, relay: { from: { kind: 'main' }, to: { kind: 'mate', id: mate.id } },
    createdAt: at(29) }));
  asks.raise({ id: 'scene-ask-send', kind: 'approve', lineId: work.id, createdAt: at(20),
    question: '在招聘网站上以你的名义发这段招呼？',
    detail: '会以你的名义发出，对方会收到，撤不回。\n发给：示例科技 · 王女士 · 产品经理',
    options: [{ id: 'allow', label: '允许', recommended: true, description: null },
      { id: 'deny', label: '先不', recommended: false, description: null }] });
  const timed = lines.blank('scene-asks-timed', 'background', '每天早上问好', { status: 'waiting',
    createdAt: at(15), updatedAt: at(15) });
  lines.put(timed);
  asks.raise({ id: 'scene-ask-timed', kind: 'confirm', lineId: timed.id, createdAt: at(15),
    question: '明早 9:00 照卡给 3 位发「早」？',
    options: [{ id: 'yes', label: '确认', recommended: true, description: null },
      { id: 'later', label: '先不', recommended: false, description: null }] });
  lines.record(MAIN_LINE_ID, user('公众号那篇怎么样了？', at(5)));
  lines.record(MAIN_LINE_ID, message({ text: '草稿存好了，三张图还没插，主编在排小标题。', createdAt: at(4) }));
}
