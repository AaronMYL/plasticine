// ?scene=files（11-16 回答带附件截图用）：他要一张投递记录表和一张官网截图，Plasticine 存进文件页再发给他——
// 一张表格文件、一张图挂在回答下面。全是虚构的公司和人。

import type { FakeAttachments } from './fake-attachments.ts';
import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';
import { SHOT_PNG } from './page-seed.ts';
import type { FileWidget, LineMessageView } from '../shared.ts';

type Draft = Omit<LineMessageView, 'lineId' | 'seq'>;

const CSV = '公司,岗位,投递时间,状态\n示例科技,产品经理,11-14,已读\n样例网络,AI 产品,11-15,未回\n';

function message(fields: Partial<Draft> & { createdAt: string }): Draft {
  return { role: 'assistant', text: '', origin: null, thinking: null, thinkingMs: null, steps: [], toolCallId: null,
    tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null, attachments: [], widgets: [],
    ...fields };
}

function file(id: string, name: string, mimeType: string, bytes: number, path: string): FileWidget {
  return { kind: 'file', id: `w-${id}`, attachmentId: id, name, mimeType, bytes, path };
}

export function seedFilesScene(lines: FakeLines, attachments: FakeAttachments, now: Date): void {
  const at = (minutes: number): string => new Date(now.getTime() - minutes * 60_000).toISOString();
  const csv = btoa(String.fromCharCode(...new TextEncoder().encode(CSV)));
  attachments.seedImage('attachment-scene-csv', '投递记录.csv', 'text/csv', csv);
  attachments.seedImage('attachment-scene-shot', '官网首页.png', 'image/png', SHOT_PNG);
  const said = '把这周投过的整理成表发我，官网首页也截一张。';
  lines.record(MAIN_LINE_ID, message({ role: 'user', text: said, origin: { kind: 'user', userText: said },
    createdAt: at(3) }));
  lines.record(MAIN_LINE_ID, message({ text: '整理好了：这周投了 2 份，示例科技已读、样例网络还没回。表和截图都存在文件页的'
    + '「求职」里。', steps: [{ toolCallId: 'scene-reply', tool: 'reply_files', say: '发给你 2 个文件' }],
  stopReason: 'toolUse', createdAt: at(2) }));
  lines.record(MAIN_LINE_ID, message({ role: 'toolResult', toolCallId: 'scene-reply', tool: 'reply_files',
    say: '发给你 2 个文件', ok: true, text: '{"sent":["投递记录.csv","官网首页.png"]}', createdAt: at(2),
    widgets: [file('attachment-scene-csv', '投递记录.csv', 'text/csv', CSV.length, '求职/投递记录.csv'),
      file('attachment-scene-shot', '官网首页.png', 'image/png', 1_200, '求职/官网首页.png')] }));
  lines.record(MAIN_LINE_ID, message({ stopReason: 'stop', createdAt: at(2) }));
}
