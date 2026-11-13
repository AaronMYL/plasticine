// ?scene=page：主线里一句开着「问这一页」发出去的话——带一页网页的结构和当时的截图（11-13 快照卡）。假的网页、假的截图。

import { textQuoteBlock } from '../shared.ts';
import type { FakeAttachments } from './fake-attachments.ts';
import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';

const SHOT_ID = 'attachment-page-shot';
// 300×170 的示意图：顶上一条蓝、下面几行灰字。
const SHOT_PNG = 'iVBORw0KGgoAAAANSUhEUgAAASwAAACqCAIAAACYgeVTAAABzklEQVR42u3csQmAMBBA0WzkAlaOkEXc1EawzBgRO3cQJEfuwZvA+KvcpSz7BQxUfAIQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQECGIEBAhiBAQIYgQ+CnCfj/AQCIEEYIIARGCCAERgggBEYIIARGCCIGYEa5bJSA/sQgRISIUISJEhIhQhIgQESJCESJCRIgIRYgIESHG1kCEgAhBhIAIQYSACEGEgAhBhIAIQYSACEGEgAhBhMDXCI+zQRIiBBGKEBGKEEQoQkQoQhAhIEIQISBCECEgQhAhIEIQISBCsE8IGYfLRAgiFCEiFCGI0KkjQhFC5ggBEYIIARGCCAERgggBEYIIARGCsTWgiRBECCIUIYgQRChCmD5CwD0hiBAQIYgQECGIEBAhiBAQIdgnhHmeoxchIhShCBGhCBGhCEWICEWICEUIiBBECIgQRAiIEEQIiBBECIgQRGhsDaN2IgQROjZEKEIQIYhQhJA3QkCEIEJAhCBCQIQgQkCEIEJAhGCfEE/KI0IRIkJEiAhFiAgRISIUIa4oABGCCAERgggBEYIIARGCCAERgggBEYIIARGCCAERgggBEYIIARGCCAERgggBEUIQLzauLL5j9S1NAAAAAElFTkSuQmCC';
const ASKED = '这条消息怎么回？';
const PAGE = ['招聘网站 · 消息', 'https://jobs.example.com/chat',
  '〔网页标签 tabId=web-demo，元素编号这一版 version=demo1：要在这一页上做事，用 Mac 的 device_action tab_act 按编号点、填、选、翻页；提交前先问他〕',
  '', '[1 链接「首页」]', '', '[2 链接「职位」]', '', '[3 输入框「搜索联系人」]', '', '方便问一下，薪资只在标注的范围里吗？',
  `〔网页快照：附件 ${SHOT_ID}〕`].join('\n');

const EMPTY = { thinking: null, thinkingMs: null, steps: [], toolCallId: null, tool: null, say: null, ok: null,
  summary: null, childLineId: null, widgets: [] };

export function seedPageScene(lines: FakeLines, attachments: FakeAttachments, now: Date): void {
  attachments.seedImage(SHOT_ID, '网页快照 招聘网站 · 消息.png', 'image/png', SHOT_PNG);
  const asked = new Date(now.getTime() - 4 * 60_000);
  lines.record(MAIN_LINE_ID, { ...EMPTY, role: 'user', attachments: [SHOT_ID], stopReason: null,
    text: `${textQuoteBlock({ label: '招聘网站 · 消息', text: PAGE })}\n\n${ASKED}`,
    origin: { kind: 'user', userText: ASKED }, createdAt: asked.toISOString() });
  lines.record(MAIN_LINE_ID, { ...EMPTY, role: 'assistant', attachments: [], stopReason: 'stop',
    text: '可以这样回：先确认薪资范围是不是只在标注的区间，再说你的期望和能到岗的时间。',
    createdAt: new Date(asked.getTime() + 40_000).toISOString() });
}
