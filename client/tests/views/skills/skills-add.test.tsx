// 技能页 · 添加（11-13）：商店、从网址、从文件，都是先看再装；带脚本的把后果写出来；商店连不上说清楚、能再试。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../helpers.tsx';

async function add(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: '添加技能' });
}

describe('技能 · 添加', () => {
  it('商店：点一张卡先看它让 Plasticine 怎么做，点安装才装；装好留在商店，卡上写已装', async () => {
    const app = await renderApp({ hash: '#/skills/add' });
    const pane = await add();
    const grid = await within(pane).findByRole('list', { name: '商店里的技能' });
    expect(within(grid).getAllByRole('button')).toHaveLength(6);
    expect((await app.api.skills.list({})).total).toBe(0);
    fireEvent.click(within(grid).getByRole('button', { name: /^会议纪要/ }));
    const preview = await screen.findByRole('complementary', { name: '「会议纪要」的内容' });
    expect(within(preview).getByText('只有方法，不带脚本')).toBeTruthy();
    expect(within(preview).getByRole('heading', { name: '装上以后 Plasticine 会这样做' })).toBeTruthy();
    expect(within(preview).getByText('没定下来的单独列成「没定的问题」。')).toBeTruthy();
    fireEvent.click(within(preview).getByRole('button', { name: '安装' }));
    await within(preview).findByRole('button', { name: '已装' });
    expect((await app.api.skills.list({})).skills.map((skill) => skill.name)).toEqual(['meeting-notes']);
    expect(window.location.hash).toBe('#/skills/add');
    await waitFor(() => expect(within(grid).getByRole('button', { name: /^会议纪要/ }).textContent).toContain('已装'));
    fireEvent.click(within(preview).getByRole('button', { name: '去看看' }));
    await waitFor(() => expect(window.location.hash).toBe('#/skills/s/meeting-notes'));
    expect(await screen.findByRole('article', { name: '会议纪要' })).toBeTruthy();
  });

  it('带脚本的：卡上有「带脚本」，先看时写明会在这台机器上运行脚本；分类和查找能筛', async () => {
    await renderApp({ hash: '#/skills/add' });
    const pane = await add();
    const grid = await within(pane).findByRole('list', { name: '商店里的技能' });
    fireEvent.click(within(within(pane).getByRole('group', { name: '分类' })).getByRole('button', { name: '生活' }));
    expect(within(grid).getAllByRole('button').map((card) => card.querySelector('.store-card-title')?.textContent))
      .toEqual(['旅行计划']);
    fireEvent.click(within(within(pane).getByRole('group', { name: '分类' })).getByRole('button', { name: '全部' }));
    fireEvent.change(within(pane).getByRole('searchbox', { name: '找技能' }), { target: { value: '表格' } });
    const card = within(grid).getByRole('button', { name: /^表格清洗/ });
    expect(card.textContent).toContain('带脚本');
    fireEvent.click(card);
    const preview = await screen.findByRole('complementary', { name: '「表格清洗」的内容' });
    expect(within(preview).getByRole('note').textContent).toContain('会在这台机器上运行里面的脚本');
  });

  it('商店连不上：写原因，能再试', async () => {
    const app = await renderApp({ hash: '#/skills/add', setup: (fake) => {
      fake.control.m5b.skills.storeDown = '技能商店暂时连不上，稍后再试。';
    } });
    const pane = await add();
    expect((await within(pane).findByRole('alert')).textContent).toContain('技能商店暂时连不上');
    app.control.m5b.skills.storeDown = null;
    fireEvent.click(within(pane).getByRole('button', { name: '再试一次' }));
    expect(await within(pane).findByRole('list', { name: '商店里的技能' })).toBeTruthy();
  });

  it('从网址：网址不对说哪里不对；对了先看，装好去看那个技能', async () => {
    await renderApp({ hash: '#/skills/add' });
    const pane = await add();
    fireEvent.click(within(within(pane).getByRole('group', { name: '从哪添加' })).getByRole('button', { name: '从网址' }));
    const input = within(pane).getByRole('textbox', { name: '技能的网址' });
    fireEvent.change(input, { target: { value: 'https://example.com/readme' } });
    fireEvent.click(within(pane).getByRole('button', { name: '先看看' }));
    expect((await within(pane).findByRole('alert')).textContent).toContain('网址要指到 GitHub 上的一个技能目录');
    fireEvent.change(input, { target: { value: 'https://github.com/someone/skills/tree/main/daily-plan' } });
    fireEvent.click(within(pane).getByRole('button', { name: '先看看' }));
    const preview = await screen.findByRole('complementary', { name: '「daily-plan」的内容' });
    fireEvent.click(within(preview).getByRole('button', { name: '安装' }));
    await waitFor(() => expect(window.location.hash).toBe('#/skills/s/daily-plan'));
    const detail = await screen.findByRole('article', { name: 'daily-plan' });
    expect(within(detail).getByText('从网址装的')).toBeTruthy();
  });

  it('从文件：挑一个带 SKILL.md 的文件夹先看；没有 SKILL.md 的说不是技能', async () => {
    await renderApp({ hash: '#/skills/add' });
    const pane = await add();
    fireEvent.click(within(within(pane).getByRole('group', { name: '从哪添加' })).getByRole('button', { name: '从文件' }));
    const picker = within(pane).getByLabelText('选技能文件夹');
    const file = (path: string, text: string): File => {
      const made = new File([text], path.split('/').pop() ?? path, { type: 'text/markdown' });
      Object.defineProperty(made, 'webkitRelativePath', { value: path });
      return made;
    };
    fireEvent.change(picker, { target: { files: [file('notes/readme.md', '# 说明')] } });
    expect((await within(pane).findByRole('alert')).textContent).toContain('没有 SKILL.md');
    fireEvent.change(picker, { target: { files: [
      file('expense-check/SKILL.md', '---\nname: expense-check\ntitle: 报销核对\ndescription: 核对报销单\n---\n\n1. 逐行对票据。'),
      file('expense-check/scripts/sum.py', 'print(1)'),
    ] } });
    const preview = await screen.findByRole('complementary', { name: '「报销核对」的内容' });
    expect(within(preview).getByText('带脚本')).toBeTruthy();
    expect(within(preview).getByText('2 个文件')).toBeTruthy();
    expect(within(preview).getByText('逐行对票据。')).toBeTruthy();
  });

  it('手机上先看换一页，返回回到清单', async () => {
    await renderApp({ hash: '#/skills/add', width: 390 });
    const pane = await add();
    fireEvent.click(await within(pane).findByRole('button', { name: /^读论文/ }));
    await within(pane).findByRole('complementary', { name: '「读论文」的内容' });
    expect(within(pane).queryByRole('list', { name: '商店里的技能' })).toBeNull();
    fireEvent.click(within(pane).getByRole('button', { name: '回到清单' }));
    expect(await within(pane).findByRole('list', { name: '商店里的技能' })).toBeTruthy();
  });
});
