// 设置里的查找（11-12）：打几个字列出对得上的块，点了去那一段并滚到那一块；索引里每一条的段头真的在那一段里。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SETTINGS_INDEX, searchSettings } from '../../../src/views/settings/settings-index.ts';
import { renderApp, settle } from '../../helpers.tsx';

describe('设置里的查找', () => {
  it('标题对得上的在前，别的叫法对得上的在后；没打字是空', () => {
    expect(searchSettings('  ')).toEqual([]);
    expect(searchSettings('备份').map((entry) => entry.title)).toEqual(['备份']);
    expect(searchSettings('深色').map((entry) => entry.title)).toEqual(['外观']);
    expect(searchSettings('模型').map((entry) => entry.title)[0]).toBe('模型');
    expect(searchSettings('出图').map((entry) => entry.title)).toEqual(['笔记、阅读和资料']);
    expect(searchSettings('chrome').map((entry) => entry.title)).toEqual(['导入']);
  });

  it('打「并发」：列出「对话 · AI」（同时做几件事在对话那一组），点了到 AI 那一段、那一块标出来，查找框清空', async () => {
    await renderApp({ hash: '#/settings/general' });
    const pane = await screen.findByRole('dialog', { name: '设置' });
    fireEvent.change(within(pane).getByRole('searchbox', { name: '搜设置' }), { target: { value: '并发' } });
    const results = within(pane).getByRole('list', { name: '找到的设置' });
    const item = within(results).getByRole('button', { name: /对话/ });
    expect(item.textContent).toBe('对话AI');
    fireEvent.click(item);
    await waitFor(() => expect(window.location.hash).toBe('#/settings/ai'));
    const block = await within(pane).findByRole('region', { name: '对话' });
    await waitFor(() => expect(block.getAttribute('data-found')).toBe('true'));
    expect((within(pane).getByRole('searchbox', { name: '搜设置' }) as HTMLInputElement).value).toBe('');
    expect(within(pane).queryByRole('list', { name: '找到的设置' })).toBeNull();
  });

  it('对不上：说一句没有', async () => {
    await renderApp({ hash: '#/settings/general' });
    const pane = await screen.findByRole('dialog', { name: '设置' });
    fireEvent.change(within(pane).getByRole('searchbox', { name: '搜设置' }), { target: { value: '不存在的东西' } });
    expect(within(pane).getByText('没有对得上的设置')).toBeTruthy();
  });

  const sections = ['general', 'ai', 'browser', 'account', 'grants', 'system'] as const;
  it.each(sections)('索引里「%s」那一段的每一块，段头都在那一段里', async (section) => {
    await renderApp({ hash: `#/settings/${section}` });
    const pane = await screen.findByRole('dialog', { name: '设置' });
    await settle();
    // 测试里是网页，不是桌面客户端：只在客户端里有的块不查。
    const titles = SETTINGS_INDEX.filter((entry) => entry.section === section && entry.desktopOnly !== true)
      .map((entry) => entry.title);
    await waitFor(() => {
      const shown = [...pane.querySelectorAll('.settings-dialog-pane h2, .settings-dialog-pane h3')]
        .map((heading) => heading.textContent?.trim());
      expect(titles.filter((title) => !shown.includes(title))).toEqual([]);
    });
  });
});
