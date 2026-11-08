// M5 乙路几组假实现装在一起：fake/index.ts 只展开这一处（接口一份、给测试摆弄的控制一份）。

import type { M5bApi } from '../m5b-client.ts';
import type { FakeEventBus } from './event-bus.ts';
import { FakeInbox, FakeToolGroups } from './fake-inbox.ts';
import { FakeMoney } from './fake-money.ts';
import type { FakeNotes } from './fake-notes.ts';
import type { FakeSession } from './fake-session.ts';
import { FakeBrowser, FakeFiles, FakeNoteVersions } from './fake-workspace.ts';
import type { FakeReceipts } from './receipts.ts';
import { FakeSkills } from './fake-capabilities.ts';

export interface FakeM5bControl {
  skills: FakeSkills;
  money: FakeMoney;
  inbox: FakeInbox;
  toolGroups: FakeToolGroups;
  files: FakeFiles;
  browser: FakeBrowser;
}

export interface FakeM5bDeps {
  session: FakeSession;
  bus: FakeEventBus;
  receipts: FakeReceipts;
  notes: FakeNotes;
  now: () => Date;
}

export function createFakeM5b(deps: FakeM5bDeps): { api: M5bApi; control: FakeM5bControl } {
  const control: FakeM5bControl = {
    skills: new FakeSkills(deps.session),
    money: new FakeMoney(deps),
    inbox: new FakeInbox(deps),
    toolGroups: new FakeToolGroups(deps),
    files: new FakeFiles(deps),
    browser: new FakeBrowser(deps),
  };
  return { api: { ...control, noteVersions: new FakeNoteVersions(deps.notes, deps.session) }, control };
}

/** 本地开发看得到东西：几封站内信、一个文件夹。 */
export function seedM5b(control: FakeM5bControl, now: Date): void {
  // 站内信并进了联系人（第 113 条）：邮件按发件地址、反馈按来源各成一个联系人，放得比联系人示例早一些。
  control.inbox.seed({
    id: 'inbox_demo_1',
    title: '周末见',
    body: '周六下午三点，老地方。',
    fromName: '大鹏',
    receivedAt: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
    read: true,
  });
  control.inbox.seed({ id: 'inbox_demo_2', source: 'feedback', fromAddress: '小雨', title: '按钮太小', body: '手机上点不中',
    receivedAt: new Date(now.getTime() - 3 * 86_400_000).toISOString() });
  control.files.seed('报告', 'directory');
  control.files.seed('报告/周报.md');
}
