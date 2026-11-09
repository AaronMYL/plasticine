// 第 8 批第 6 条（设计稿 Chat-Letter）：主线里收到来信——昨晚说的研究周报样刊写好了，早上 Plasticine 一句话带一张来信卡。
// 地址里 ?scene=letter 时种这一段（来信本身是空间种子里的 sp_letter_dream）。

import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';

const SAID = '每周五为我整理认知科学、神经科学、意识的最新重要研究，重点解读原始论文。';
const REPORT = '**第 1 期样刊写好了。** 重点解读 2 篇原始研究：1 篇 Nature Neuroscience 正式论文、1 篇未评审预印本，'
  + '已分开标出。\n\n[认知科学与意识研究周报 · 第 1 期](#/books/space/sp_cog_1)';
const LETTER = '给你写了一封信：你定的「做梦」，今天信息流里有篇原文能对上。';

const EMPTY = { thinking: null, thinkingMs: null, steps: [], toolCallId: null, tool: null, say: null, ok: null,
  summary: null, childLineId: null, attachments: [], widgets: [] };

export function seedLetterScene(lines: FakeLines, now: Date): void {
  const night = new Date(now.getTime() - 5.5 * 3_600_000);
  lines.record(MAIN_LINE_ID, { ...EMPTY, role: 'user', text: SAID, origin: { kind: 'user', userText: SAID },
    stopReason: null, createdAt: night.toISOString() });
  lines.record(MAIN_LINE_ID, { ...EMPTY, role: 'assistant', text: REPORT, stopReason: 'stop',
    createdAt: new Date(night.getTime() + 60_000).toISOString() });
  lines.record(MAIN_LINE_ID, { ...EMPTY, role: 'letter', text: LETTER, stopReason: null,
    letter: { spaceId: 'sp_letter_dream', title: '做梦，有了一组数字' }, createdAt: now.toISOString() });
}
