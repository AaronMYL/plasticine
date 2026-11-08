// 本地开发看界面用的预置数据：几篇笔记。内容是示例，不是真数据（对话在线的种子里，lines-seed.ts）。

import type { FakeNotes } from './fake-notes.ts';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function seedNotes(notes: FakeNotes, now: Date): void {
  const day = (offset: number): string => new Date(now.getTime() - offset * DAY_MS).toISOString();
  notes.seed({
    id: 'seed_note_1',
    pinned: true,
    createdAt: day(30),
    updatedAt: day(0),
    version: 3,
    markdown: '# 这周要想清楚的事\n\n- [ ] 新版的对话栏怎么收起\n- [x] 字体打包\n\n写着写着就有了。',
  });
  notes.seed({
    id: 'seed_note_2',
    createdAt: day(3),
    updatedAt: day(1),
    markdown: '# 读书摘记\n\n一段话可以很长，长到需要换行，看中文长段在 16/28 的行高下读起来舒不舒服。',
  });
  notes.seed({
    id: 'seed_note_3',
    createdAt: day(40),
    updatedAt: day(20),
    version: 2,
    author: 'ai',
    readOnly: true,
    migrated: true,
    markdown: '# 旧版导入的一篇\n\n只读：从旧版搬来的笔记先只读，核对字节数之后再放开。',
  });
  // 2026-11-05：Plasticine 写的放在「Plasticine 写的」文件夹（原来的成果迁进来）。
  notes.seed({
    id: 'seed_note_cua',
    folder: 'Plasticine 写的',
    author: 'ai',
    createdAt: new Date(now.getTime() - 20 * 60_000).toISOString(),
    updatedAt: new Date(now.getTime() - 15 * 60_000).toISOString(),
    markdown: '# CuaDriver.app 是什么\n\nCua 的 Mac 驱动：让 AI 代理能看你的屏幕、点鼠标、敲键盘。它只听本机 Cua 的调用，'
      + '自己不联网做别的事。\n\n## 查到的\n\n- 谁做的：Cua AI, Inc.，签名有效，苹果已公证\n'
      + '- 在哪：/Applications/CuaDriver.app\n- 权限：辅助功能、屏幕录制\n- 10 月 28 日随 Cua 一起装上\n\n'
      + '## 要不要留\n\n在用 Cua 就留着。不用了，先在「系统设置 › 隐私与安全性」里关掉辅助功能和屏幕录制，再删应用。',
  });
  notes.seed({
    id: 'seed_note_bolt',
    folder: 'Plasticine 写的',
    author: 'ai',
    createdAt: day(0),
    updatedAt: new Date(now.getTime() - 90 * 60_000).toISOString(),
    markdown: '# 回 Bolt 的账单邮件\n\n你好，我们从这个月起不再续订 Pro 方案，本期结束后请停止扣费。',
  });
}
