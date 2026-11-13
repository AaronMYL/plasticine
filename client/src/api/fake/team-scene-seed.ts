// ?scene=team（11-13 分工面板截图用）：四位虚构队友、一个群组，群里的事各种状态都有一件。全是虚构的人和事。

import type { FakeLines } from './fake-lines.ts';
import type { FakeMates } from './fake-mates.ts';
import type { MateCharacter, MateView } from '../shared.ts';

export async function seedTeamScene({ mates, lines }: { mates: FakeMates; lines: FakeLines }, now: Date): Promise<void> {
  const make = (name: string, avatar: MateCharacter, hue: string, role: string) => mates.create({
    requestId: `scene-team-${avatar}`, name, avatar, hue: hue as MateView['hue'], role, soul: '', purpose: null });
  const [pm, design, dev, test] = await Promise.all([make('产品经理', 'bob', 'plum', '把需求整理成规格'),
    make('设计师', 'curly', 'rose', '出界面设计稿'), make('开发工程师', 'bot', 'sky', '照规格写代码'),
    make('测试工程师', 'hedgehog', 'teal', '按验收标准逐条测')]);
  const group = await mates.groups.create({ requestId: 'scene-team-group', name: '软件开发',
    mateIds: [pm.id, design.id, dev.id, test.id] });
  const ago = (minutes: number): string => new Date(now.getTime() - minutes * 60_000).toISOString();
  const put = (id: string, title: string, extra: Parameters<FakeLines['blank']>[3]): void => {
    lines.put(lines.blank(id, 'background', title, { parentLineId: group.lineId, mateGroupId: group.id, ...extra }));
  };
  put('team-spec', '把需求整理成规格', { mateId: pm.id, status: 'running', activity: '在读上周的访谈…',
    activeSince: ago(12) });
  put('team-spec-done', '列出上周访谈的结论', { mateId: pm.id, status: 'idle', outcome: 'done', updatedAt: ago(90) });
  put('team-design', '首页改版设计稿', { mateId: design.id, status: 'waiting', updatedAt: ago(8) });
  put('team-design-done', '整理现有页面的截图', { mateId: design.id, status: 'idle', outcome: 'done',
    updatedAt: ago(200) });
  put('team-test', '回归上一版的 12 条', { mateId: test.id, status: 'running', activity: '7 / 12 条过了…',
    activeSince: ago(4) });
  await mates.groups.createTask(group.id, { requestId: 'scene-team-task', text: '把验收标准写成测试清单' });
}
