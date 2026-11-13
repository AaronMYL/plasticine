// 新标签页（网页栏目没选标签时）：输入框右边直接切搜索引擎（11-13 Aaron：「浏览器的搜索引擎要能在新标签中直接切换」），
// 切了立刻记住，和设置 · 浏览器里的是同一份。

import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readSearchEngine } from '../../../src/shell/search-engine.ts';
import { renderApp } from '../../helpers.tsx';

afterEach(() => localStorage.clear());

describe('新标签页 · 搜索引擎', () => {
  it('输入框右边写着现在用哪个搜，点开能换，换了就记住', async () => {
    await renderApp({ hash: '#/web' });
    const form = await screen.findByRole('search');
    const pick = within(form).getByRole('button', { name: '搜索引擎：必应' });
    fireEvent.click(pick);
    const menu = await screen.findByRole('menu', { name: '搜索引擎' });
    expect(within(menu).getAllByRole('menuitemcheckbox').map((item) => item.textContent))
      .toEqual(['必应', '谷歌', '百度', 'DuckDuckGo']);
    expect(within(menu).getByRole('menuitemcheckbox', { name: '必应' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: '谷歌' }));
    expect(screen.queryByRole('menu', { name: '搜索引擎' })).toBeNull();
    expect(within(form).getByRole('button', { name: '搜索引擎：谷歌' })).toBeTruthy();
    expect(readSearchEngine()).toBe('google');
    expect((within(form).getByRole('textbox', { name: '网址或要搜的词' }) as HTMLInputElement).placeholder)
      .toBe('打网址，或用谷歌搜');
  });
});
