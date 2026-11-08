// 设置 · 信息流来源（第 3 批，用户 11-04 定）：X、每个订阅、按关注点搜新闻各一行——开关、频率或地址；上次没抓到 / 没读到
// 就在那一行写原因；上次读到的时间在 ⓘ 里；段头「加订阅」只要网址；关注点在新闻那一行的 ⋯ 里。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { NOW, renderApp, settle } from '../../helpers.tsx';

function seed(fake: FakeApi): void {
  const { feed } = fake.control;
  feed.seedSource({ id: 'src_sync', kind: 'interest', label: '本地优先同步' });
  feed.seedSource({ id: 'src_off', kind: 'interest', label: '关掉的关注点', level: 'off' });
  feed.seedSource({ id: 'src_blog', kind: 'rss', label: '慢工博客', query: 'https://blog.example.org/feed',
    status: { checkedAt: NOW.toISOString(), okAt: NOW.toISOString(), error: null } });
  feed.seedSource({ id: 'src_x', kind: 'x', label: 'X · 你关注的人', ref: 'x:following',
    status: { checkedAt: NOW.toISOString(), okAt: null, error: '在 Plasticine 浏览器里登录 X' } });
  feed.seedSource({ id: 'src_news', kind: 'internal', label: '按关注点搜新闻', ref: 'internal:news',
    status: { checkedAt: NOW.toISOString(), okAt: null, error: '选材未完成：订阅额度用完了' } });
}

function rows(): HTMLElement {
  return screen.getByRole('list', { name: '信息流来源' });
}

function row(name: string): HTMLElement {
  return within(rows()).getByRole('listitem', { name });
}

describe('设置 · 信息流来源', () => {
  it('每个来源一行：X、订阅、按关注点搜新闻；频率或地址常显，出错的写原因；上次读到的时间在浮框里', async () => {
    await renderApp({ hash: '#/settings/feed', setup: seed });
    await settle();
    expect(within(rows()).getAllByRole('listitem').map((item) => item.getAttribute('aria-label')))
      .toEqual(['X · 你关注的人', '慢工博客', '按关注点搜新闻']);
    expect(row('X · 你关注的人').textContent).toContain('在 Plasticine 浏览器里登录 X');
    expect(row('X · 你关注的人').querySelector('.is-error')).not.toBeNull();
    expect(row('慢工博客').textContent).toContain('https://blog.example.org/feed');
    // 整行不挂浮框（11-04）；上次读到的时间在 ⓘ 里，没读到过的那一行没有 ⓘ。
    expect(row('慢工博客').getAttribute('data-tip')).toBeNull();
    expect(within(row('慢工博客')).getByRole('button', { name: '「慢工博客」上次读到的时间' })
      .getAttribute('aria-description')).toMatch(/^上次读到：/);
    expect(within(row('X · 你关注的人')).queryByRole('button', { name: /上次读到的时间$/ })).toBeNull();
    expect(row('按关注点搜新闻').textContent).toContain('选材未完成：订阅额度用完了');
    expect(within(row('慢工博客')).getByRole('switch', { name: '慢工博客' })).toHaveProperty('checked', true);
  });

  it('没出错时 X 那一行写频率、新闻那一行写几个关注点和几点搜', async () => {
    await renderApp({ hash: '#/settings/feed', setup: (fake) => {
      seed(fake);
      fake.control.feed.seedSource({ id: 'src_x', kind: 'x', label: 'X · 你关注的人', ref: 'x:following' });
      fake.control.feed.seedSource({ id: 'src_news', kind: 'internal', label: '按关注点搜新闻',
        ref: 'internal:news' });
    } });
    await settle();
    expect(row('X · 你关注的人').textContent).toContain('Mac 在线时每 2 小时读一次');
    expect(row('按关注点搜新闻').textContent).toContain('1 个关注点 · 每天 07:00');
  });

  it('关掉一个订阅：开关一拨就是关着，服务端的档位是 off；再拨回来是正常', async () => {
    const app = await renderApp({ hash: '#/settings/feed', setup: seed });
    await settle();
    const toggle = (): HTMLElement => within(row('慢工博客')).getByRole('switch', { name: '慢工博客' });
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).toHaveProperty('checked', false));
    expect((await app.api.feed.sources()).others.find((source) => source.id === 'src_blog')?.level).toBe('off');
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).toHaveProperty('checked', true));
    expect((await app.api.feed.sources()).others.find((source) => source.id === 'src_blog')?.level).toBe('normal');
  });

  it('段头「加订阅」打开只要网址的表单；新闻那一行的 ⋯ 里打开关注点', async () => {
    await renderApp({ hash: '#/settings/feed', setup: seed });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '加订阅' }));
    const form = screen.getByRole('form', { name: '加订阅' });
    fireEvent.change(within(form).getByRole('textbox', { name: '网站或订阅地址' }),
      { target: { value: 'https://indie.example.com/' } });
    fireEvent.click(within(form).getByRole('button', { name: '加订阅' }));
    await waitFor(() => expect(within(rows()).getByRole('listitem', { name: 'indie.example.com' })).toBeTruthy());
    fireEvent.click(within(row('按关注点搜新闻')).getByRole('button', { name: '「按关注点搜新闻」的更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '关注点…' }));
    const sheet = screen.getByRole('dialog', { name: '关注点' });
    expect(within(sheet).getByRole('list', { name: '关注点' })).toBeTruthy();
  });
});
