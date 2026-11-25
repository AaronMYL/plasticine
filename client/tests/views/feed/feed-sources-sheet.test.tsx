import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { renderApp, settle } from '../../helpers.tsx';

function main(): HTMLElement {
  return screen.getByRole('main');
}

function mainArea(): HTMLElement {
  const area = main().closest<HTMLElement>('.shell-main-area');
  if (area === null) throw new Error('没有主区');
  return area;
}

function seed(fake: FakeApi): void {
  fake.control.feed.seedSource({ id: 'src_sync', kind: 'interest', label: '本地优先同步', query: 'local-first' });
  fake.control.feed.seedItem({ id: 'f_1', title: '一篇', sourceId: 'src_sync', origin: 'feed' });
}

describe('feed: add source sheet', () => {
  it('desktop opens add-source as overlay sheet from rail + button and closes cleanly', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    expect(within(main()).queryByRole('region', { name: '加来源' })).toBeNull();
    const open = within(screen.getByRole('complementary', { name: '阅读' })).getByRole('button', { name: '加来源' });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(open);
    const sheet = within(mainArea()).getByRole('dialog', { name: '加来源' });
    expect(sheet.className).toContain('sheet-panel');
    expect(sheet.getAttribute('aria-modal')).toBeNull();
    const kinds = ['博客', 'Reddit', '兴趣', 'X', '小红书', '抖音收藏'];
    expect(within(sheet).getAllByRole('tab')).toEqual(kinds.map((name) => within(sheet).getByRole('tab', { name })));
    expect(within(sheet).getByRole('tab', { name: '博客' }).getAttribute('aria-selected')).toBe('true');
    expect(within(sheet).getByRole('form', { name: '加订阅' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('tab', { name: '小红书' }));
    expect(within(sheet).getByRole('tabpanel', { name: '小红书' }).textContent).toContain('首页「推荐」和你的收藏');
    fireEvent.click(within(sheet).getByRole('tab', { name: 'Reddit' }));
    const reddit = within(sheet).getByRole('tabpanel', { name: 'Reddit' }).textContent ?? '';
    expect(reddit).toContain('在电脑上的 Plasticine 浏览器里登录 Reddit');
    expect(reddit).toContain('电脑在线时用这个登录去取');
    fireEvent.click(within(sheet).getByRole('tab', { name: '兴趣' }));
    expect(within(sheet).getByRole('region', { name: '加关注点' })).toBeTruthy();
    expect(open.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(sheet).getByRole('button', { name: '关掉加来源' }));
    expect(within(mainArea()).queryByRole('dialog', { name: '加来源' })).toBeNull();
    expect(within(main()).getByRole('listitem', { name: '一篇' })).toBeTruthy();
  });

  it('mobile uses Manage Sources drawer and bottom add-source drawer closing on Esc', async () => {
    await renderApp({ hash: '#/feed', width: 390, setup: seed });
    await settle();
    expect(within(main()).queryByRole('button', { name: '查找内容' })).toBeNull();
    expect(within(main()).getByRole('button', { name: '刷新全部来源' })).toBeTruthy();
    fireEvent.click(within(main()).getByRole('button', { name: '管理来源' }));
    const filter = within(main()).getByRole('dialog', { name: '管理来源' });
    expect(await within(filter).findByRole('list', { name: '来源' })).toBeTruthy();
    fireEvent.click(within(filter).getByRole('button', { name: '加来源' }));
    const sheet = within(main()).getByRole('dialog', { name: '加来源' });
    expect(sheet.className).toContain('sheet-drawer');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(within(main()).queryByRole('dialog', { name: '加来源' })).toBeNull();
  });
});
