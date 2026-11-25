import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readSearchEngine } from '../../../src/shell/search-engine.ts';
import { renderApp } from '../../helpers.tsx';

afterEach(() => localStorage.clear());

describe('New tab - Search engine', () => {
  it('shows active search engine next to input, allows switching, and persists selection', async () => {
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
