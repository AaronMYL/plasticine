// 技能页（11-13）：#/skills 目录 + 一个技能；入口在 Plasticine 栏和设置 · AI；随应用的不能删，别的删之前后果常显。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { renderApp } from '../../helpers.tsx';

function seed(fake: FakeApi): void {
  fake.control.m5b.skills.seedPage();
}

async function catalog(): Promise<HTMLElement> {
  const list = await screen.findByRole('region', { name: '技能目录' });
  await within(list).findAllByRole('listitem');
  return list;
}

describe('技能页', () => {
  it('电脑上目录和详情并排：没点哪一个时右边是第一个；按来源筛；随应用的没有删除', async () => {
    await renderApp({ hash: '#/skills', setup: seed });
    const list = await catalog();
    expect(within(list).getAllByRole('link').map((link) => link.querySelector('.skill-card-name')?.textContent))
      .toEqual(['Plasticine 怎么用', '视频解析', '周报整理']);
    const detail = await screen.findByRole('article', { name: 'Plasticine 怎么用' });
    expect(within(detail).getByText('plasticine-guide')).toBeTruthy();
    expect(within(detail).getByText('跟着应用更新')).toBeTruthy();
    expect(within(detail).queryByRole('button', { name: /^删除/ })).toBeNull();
    expect(await within(detail).findByText('功能还没有的，直接说没有，不编。')).toBeTruthy();
    const kinds = within(list).getByRole('group', { name: '来源' });
    expect(within(kinds).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['全部 3', '随应用 2', 'Plasticine 整理 1']);
    fireEvent.click(within(kinds).getByRole('button', { name: 'Plasticine 整理 1' }));
    expect(within(list).getAllByRole('link')).toHaveLength(1);
  });

  it('点一行换到那个技能；删要先确认，确认后目录里没了、回到目录', async () => {
    const app = await renderApp({ hash: '#/skills', setup: seed });
    const list = await catalog();
    fireEvent.click(within(list).getByRole('link', { name: /周报整理/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/skills/s/weekly-digest'));
    const detail = await screen.findByRole('article', { name: '周报整理' });
    expect(within(detail).getByText('用过 4 次')).toBeTruthy();
    fireEvent.click(within(detail).getByRole('button', { name: '删除「周报整理」' }));
    const confirm = within(detail).getByRole('alertdialog', { name: '删除「周报整理」' });
    expect(confirm.textContent).toContain('正在用它的线不受影响');
    fireEvent.click(within(confirm).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(window.location.hash).toBe('#/skills'));
    expect((await app.api.skills.list({})).total).toBe(2);
    await waitFor(() => expect(within(screen.getByRole('region', { name: '技能目录' })).getAllByRole('link'))
      .toHaveLength(2));
  });

  it('找技能：按名字、短名、说明找', async () => {
    await renderApp({ hash: '#/skills', setup: seed });
    const list = await catalog();
    fireEvent.click(within(list).getByRole('button', { name: '找技能' }));
    fireEvent.change(within(list).getByRole('searchbox', { name: '找技能' }), { target: { value: 'video' } });
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    fireEvent.change(within(list).getByRole('searchbox', { name: '找技能' }), { target: { value: '没有这个' } });
    expect(within(list).getByText('没有匹配的技能')).toBeTruthy();
  });

  it('入口：Plasticine 栏的名单最下面有「技能」；设置 · AI 只留一行「打开技能页」', async () => {
    await renderApp({ hash: '#/plasticine', setup: seed });
    const link = await screen.findByRole('link', { name: '技能' });
    fireEvent.click(link);
    await waitFor(() => expect(window.location.hash).toBe('#/skills'));
    await catalog();
    expect(screen.getByRole('link', { name: '技能' }).getAttribute('aria-current')).toBe('page');
    window.location.hash = '#/settings/ai';
    const pane = await screen.findByRole('dialog', { name: '设置' });
    const open = await within(pane).findByRole('link', { name: '打开技能页' });
    expect(open.getAttribute('href')).toBe('#/skills');
    expect(within(pane).queryByRole('list', { name: '技能目录' })).toBeNull();
  });

  it('手机上一次一页：目录点一行进那个技能，返回回到目录', async () => {
    await renderApp({ hash: '#/skills', width: 390, setup: seed });
    const list = await catalog();
    expect(screen.queryByRole('article')).toBeNull();
    expect(within(list).getByRole('button', { name: '添加技能' })).toBeTruthy();
    expect(within(list).getByRole('button', { name: '新建技能' })).toBeTruthy();
    fireEvent.click(within(list).getByRole('link', { name: /视频解析/ }));
    await screen.findByRole('article', { name: '视频解析' });
    expect(screen.queryByRole('region', { name: '技能目录' })).toBeNull();
  });
});

describe('技能页 · 电脑上主区窄', () => {
  it('主区窄于 640 时一次只放一栏：目录一栏，点一个技能换成详情，有「回到技能」', async () => {
    // jsdom 不排版：给它一个会量宽的 ResizeObserver，这一页量出来是 500。
    const rect = HTMLElement.prototype.getBoundingClientRect;
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} });
    HTMLElement.prototype.getBoundingClientRect = function narrow(this: HTMLElement): DOMRect {
      return this.classList.contains('skills-root') ? { ...rect.call(this), width: 500 } as DOMRect : rect.call(this);
    };
    try {
      await renderApp({ hash: '#/skills', setup: seed });
      const list = await catalog();
      expect(screen.queryByRole('article')).toBeNull();
      fireEvent.click(within(list).getByRole('link', { name: /视频解析/ }));
      await screen.findByRole('article', { name: '视频解析' });
      expect(screen.queryByRole('region', { name: '技能目录' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '回到技能' }));
      await catalog();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = rect;
      vi.unstubAllGlobals();
    }
  });
});
