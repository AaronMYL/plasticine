// 资料库（2026-11-08 他定）：订阅挪到资料库按订阅分组、订阅页；空间、图书都能改名、删除，删了进「最近删除」能还原；
// 地址 #/library、#/library/sub/<id>、#/library/trash，手机上都能开。
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY_HOME, LIBRARY_TRASH, subscriptionRoute } from '../../../src/shell/library-routes.ts';
import { parseHash, phonePageAvailable, routeHash } from '../../../src/shell/routes.ts';
import { sectionOf } from '../../../src/shell/sections.ts';
import { issueRange, subscriptionLine } from '../../../src/views/library/subscription-text.ts';
import { renderApp, setViewportWidth } from '../../helpers.tsx';

function column(): HTMLElement {
  const aside = document.querySelector<HTMLElement>('aside.column');
  if (aside === null) throw new Error('没有第二栏');
  return aside;
}

async function open(hash: string, width = 1440) {
  return renderApp({ hash, width, setup: (fake) => fake.control.spaces.seed() });
}

afterEach(() => {
  setViewportWidth(1440);
  vi.restoreAllMocks();
});

describe('资料库的地址', () => {
  it('#/library、#/library/sub/<id>、#/library/trash 来回不变，归资料库栏目，手机能开', () => {
    for (const route of [LIBRARY_HOME, subscriptionRoute('sub-review'), LIBRARY_TRASH]) {
      expect(parseHash(routeHash(route))).toEqual(route);
      expect(sectionOf(route)).toBe('library');
      expect(phonePageAvailable(route)).toBe(true);
    }
    expect(routeHash(subscriptionRoute('sub-review'))).toBe('#/library/sub/sub-review');
    expect(routeHash(LIBRARY_TRASH)).toBe('#/library/trash');
    expect(parseHash('#/library/sub/%')).toEqual(LIBRARY_HOME);
    expect(parseHash('#/library/whatever')).toEqual(LIBRARY_HOME);
  });

  it('页头那一行和往期的日期区间', () => {
    expect(subscriptionLine({ status: 'sample', settings: { kind: 'research', topics: [], focus: null, depth: null,
      sources: [], preprints: 'mark', filter: '', schedule: { every: 'week', weekday: 5, time: '08:00' },
      sections: [], output: '', rules: [] } })).toBe('每周五 08:00 · 还没开定时');
    expect(issueRange({ createdAt: '2026-11-08T01:00:00Z', edition: null }, 'Asia/Shanghai')).toBe('11月2日–8日');
    expect(issueRange({ createdAt: '2026-11-02T01:00:00Z', edition: null }, 'Asia/Shanghai'))
      .toBe('10月27日–11月2日');
    expect(issueRange({ createdAt: '2026-11-07T01:00:00Z', edition: 'daily' }, 'Asia/Shanghai')).toBe('11月7日');
  });
});

describe('资料库第二栏', () => {
  it('顶上「订阅」一组带往期数；「空间」只放不属于订阅的；底部「最近删除」带数量', async () => {
    await open('#/library');
    const aside = column();
    const subs = await within(aside).findByRole('link', { name: /个人回顾/ });
    expect(subs.getAttribute('href')).toBe('#/library/sub/sub-review');
    expect(subs.textContent).toContain('2');
    expect(within(aside).getByRole('link', { name: /认知与神经科学研究周报/ }).textContent).toContain('2');
    await within(aside).findByRole('link', { name: '马来西亚签证核查' });
    expect(within(aside).queryByRole('link', { name: /研究周报 · 第 2 期/ })).toBeNull();
    expect(within(aside).queryByRole('link', { name: /日报 · 11月7日/ })).toBeNull();
    const trash = within(aside).getByRole('link', { name: /最近删除/ });
    await waitFor(() => expect(trash.textContent).toContain('1'));
  });

  it('空间行 ⋯ 改名：原处改，回车存，列表名跟着变', async () => {
    const app = await open('#/library');
    const aside = column();
    await within(aside).findByRole('link', { name: '马来西亚签证核查' });
    fireEvent.click(within(aside).getByRole('button', { name: '「马来西亚签证核查」的更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '改名' }));
    const field = within(aside).getByRole('textbox', { name: '「马来西亚签证核查」的新名字' });
    fireEvent.change(field, { target: { value: '马来西亚签证核查（2026）' } });
    await act(async () => fireEvent.keyDown(field, { key: 'Enter' }));
    await within(aside).findByRole('link', { name: '马来西亚签证核查（2026）' });
    expect((await app.api.spaces.get('sp_visa')).title).toBe('马来西亚签证核查（2026）');
  });

  it('空间行 ⋯ 删除：先问，删了从列表拿掉、进「最近删除」；在那一页还原回来', async () => {
    await open('#/library');
    const aside = column();
    await within(aside).findByRole('link', { name: '悬赏规则草稿' });
    fireEvent.click(within(aside).getByRole('button', { name: '「悬赏规则草稿」的更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    const dialog = screen.getByRole('alertdialog', { name: '删除「悬赏规则草稿」？' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(within(aside).getByRole('button', { name: '「悬赏规则草稿」的更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    await act(async () => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',
      { name: '删除' })));
    await waitFor(() => expect(within(aside).queryByRole('link', { name: '悬赏规则草稿' })).toBeNull());
    fireEvent.click(within(aside).getByRole('link', { name: /最近删除/ }));
    await screen.findByRole('heading', { level: 1, name: '最近删除' });
    const restore = await screen.findByRole('button', { name: '还原空间「悬赏规则草稿」' });
    expect(screen.getByRole('button', { name: '还原空间「赏金来源的旧草稿」' })).toBeTruthy();
    await act(async () => fireEvent.click(restore));
    await within(aside).findByRole('link', { name: '悬赏规则草稿' });
    await waitFor(() => expect(screen.queryByRole('button', { name: '还原空间「悬赏规则草稿」' })).toBeNull());
  });
});

describe('订阅页', () => {
  it('页头：名字、时间和状态；开着的不显示主按钮；往期是第 N 期 · 结论 · 日期，点了打开那一期', async () => {
    await open('#/library/sub/sub_research');
    await screen.findByRole('heading', { level: 1, name: '认知与神经科学研究周报' });
    expect(screen.getByText('每周一 09:00 · 已开启')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '开启定时' })).toBeNull();
    const issues = screen.getByRole('list', { name: '往期' });
    const rows = within(issues).getAllByRole('button');
    expect(rows.map((row) => row.querySelector('.lib-issue-n')?.textContent)).toEqual(['第 2 期', '第 1 期']);
    fireEvent.click(rows[0] as HTMLElement);
    await waitFor(() => expect(window.location.hash).toBe('#/books/space/sp_research_2'));
  });

  it('⋯ 暂停之后主按钮「开启定时」回来，点了又开上；设置打开订阅设置浮层', async () => {
    await open('#/library/sub/sub_research');
    await screen.findByRole('heading', { level: 1, name: '认知与神经科学研究周报' });
    fireEvent.click(screen.getByRole('button', { name: '「认知与神经科学研究周报」的更多操作' }));
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '暂停' })));
    await screen.findByText('每周一 09:00 · 已暂停');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开启定时' })));
    await screen.findByText('每周一 09:00 · 已开启');
    fireEvent.click(screen.getByRole('button', { name: '订阅设置' }));
    expect(await screen.findByRole('dialog', { name: '认知与神经科学研究周报' })).toBeTruthy();
  });

  it('空间页的出处「订阅 · 名字」点了去订阅页；空间页 ⋯ 删除一期后回订阅页', async () => {
    await open('#/books/space/sp_research_1');
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: '「研究周报 · 第 1 期」的更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    await act(async () => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',
      { name: '删除' })));
    await waitFor(() => expect(window.location.hash).toBe('#/library/sub/sub_research'));
    const issues = await screen.findByRole('list', { name: '往期' });
    await waitFor(() => expect(within(issues).getAllByRole('button')).toHaveLength(1));
  });
});

describe('手机上的资料库', () => {
  it('#/library 顶上列订阅、中间空间、底下「最近删除」；订阅页和「最近删除」都能开', async () => {
    await open('#/library', 390);
    await screen.findByRole('heading', { level: 1, name: '资料库' });
    const subs = await screen.findByRole('region', { name: '订阅' });
    fireEvent.click(await within(subs).findByRole('button', { name: /个人回顾/ }));
    await screen.findByRole('heading', { level: 1, name: '个人回顾' });
    act(() => {
      window.location.hash = '#/library/trash';
    });
    await screen.findByRole('heading', { level: 1, name: '最近删除' });
    expect(await screen.findByText('赏金来源的旧草稿')).toBeTruthy();
  });
});
