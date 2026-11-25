import { toastStore } from '../../../src/primitives/toast/index.tsx';
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

describe('library routes', () => {
  it('#/library, #/library/sub/<id>, and #/library/trash roundtrip in library section and mobile', () => {
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

  it('header subtitle and past-issue date range', () => {
    expect(subscriptionLine({ status: 'sample', settings: { kind: 'research', topics: [], focus: null, depth: null,
      sources: [], preprints: 'mark', filter: '', schedule: { every: 'week', weekday: 5, time: '08:00' },
      sections: [], output: '', rules: [] } })).toBe('每周五 08:00 · 还没开定时');
    expect(issueRange({ createdAt: '2026-11-08T01:00:00Z', edition: null }, 'Asia/Shanghai')).toBe('11月2日–8日');
    expect(issueRange({ createdAt: '2026-11-02T01:00:00Z', edition: null }, 'Asia/Shanghai'))
      .toBe('10月27日–11月2日');
    expect(issueRange({ createdAt: '2026-11-07T01:00:00Z', edition: 'daily' }, 'Asia/Shanghai')).toBe('11月7日');
  });
});

describe('library secondary rail', () => {
  it('lists Subscriptions with issue count, standalone Spaces, and bottom Recently Deleted count', async () => {
    await open('#/library');
    const aside = column();
    const subs = await within(aside).findByRole('link', { name: /个人回顾/ });
    expect(subs.getAttribute('href')).toBe('#/library/sub/sub-review');
    expect(subs.textContent).toContain('3');
    expect(within(aside).getByRole('link', { name: /认知与神经科学研究周报/ }).textContent).toContain('2');
    await within(aside).findByRole('link', { name: '马来西亚签证核查' });
    expect(within(aside).queryByRole('link', { name: /研究周报 · 第 2 期/ })).toBeNull();
    expect(within(aside).queryByRole('link', { name: /日报 · 11月7日/ })).toBeNull();
    expect(within(aside).getByRole('link', { name: /AI 信息流核查/ })).toBeTruthy();
    const trash = within(aside).getByRole('link', { name: /最近删除/ });
    await waitFor(() => expect(trash.textContent).toContain('1'));
  });

  it('space row overflow rename edits inline, saves on Enter, and updates list title', async () => {
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

  it('space row menu delete removes immediately into Recently Deleted and can be restored there', async () => {
    await open('#/library');
    const aside = column();
    await within(aside).findByRole('link', { name: '悬赏规则草稿' });
    fireEvent.click(within(aside).getByRole('button', { name: '「悬赏规则草稿」的更多操作' }));
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '删除' })));
    expect(screen.queryByRole('alertdialog')).toBeNull();
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

describe('Library home (batch 8 item 6, Library-Spaces design)', () => {
  it('thumbnail cards show 3 recent, all with count, title, report/letter time, and menu', async () => {
    await open('#/library');
    const recent = await screen.findByRole('region', { name: '最近' });
    const cards = await within(recent).findAllByRole('listitem');
    expect(cards).toHaveLength(3);
    expect(within(cards[0] as HTMLElement).getByRole('link', { name: '做梦，有了一组数字' }).getAttribute('href'))
      .toBe('#/books/space/sp_letter_dream');
    expect(within(cards[0] as HTMLElement).getByText(/^来信 · \S+/)).toBeTruthy();
    expect(within(cards[1] as HTMLElement).getByText(/^报告 · /)).toBeTruthy();
    const all = screen.getByRole('region', { name: '全部' });
    const count = within(all).getAllByRole('listitem').length;
    expect(within(all).getByRole('heading', { level: 2 }).textContent).toBe(`全部${count}`);
    expect(within(all).getByRole('link', { name: '马来西亚签证核查' })).toBeTruthy();
    expect(document.querySelectorAll('.lib-card .space-thumb').length).toBe(count + 3);
  });

  it('card menu renames inline and deletes immediately with undo', async () => {
    const app = await open('#/library');
    const all = await screen.findByRole('region', { name: '全部' });
    fireEvent.click(within(all).getByRole('button', { name: '「AI 信息流核查｜记忆、子代理与商业落地」的更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '改名' }));
    const field = within(all).getByRole('textbox', { name: '「AI 信息流核查｜记忆、子代理与商业落地」的新名字' });
    fireEvent.change(field, { target: { value: 'AI 信息流核查' } });
    await act(async () => fireEvent.keyDown(field, { key: 'Enter' }));
    await waitFor(async () => expect((await app.api.spaces.get('sp_aifeed')).title).toBe('AI 信息流核查'));
    fireEvent.click(within(all).getByRole('button', { name: '「马来西亚签证核查」的更多操作' }));
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '删除' })));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(toastStore.get()?.text).toBe('已把「马来西亚签证核查」移到最近删除'));
  });
});

describe('Subscription page', () => {
  it('header shows name, time, status without primary button when active; past issues open on click', async () => {
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

  it('pausing restores Enable schedule button to re-enable; settings opens subscription popover', async () => {
    await open('#/library/sub/sub_research');
    await screen.findByRole('heading', { level: 1, name: '认知与神经科学研究周报' });
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: '「认知与神经科学研究周报」的更多操作' }));
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '暂停' })));
    await screen.findByText('每周一 09:00 · 已暂停');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开启定时' })));
    await screen.findByText('每周一 09:00 · 已开启');
    expect(within(screen.getByRole('main')).queryByRole('button', { name: '订阅设置' })).toBeNull();
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: '「认知与神经科学研究周报」的更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '订阅设置' }));
    expect(await screen.findByRole('dialog', { name: '认知与神经科学研究周报' })).toBeTruthy();
  });

  it('space source link opens subscription page; deleting an issue returns to subscription page', async () => {
    await open('#/books/space/sp_research_1');
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: '「研究周报 · 第 1 期」的更多操作' }));
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '删除' })));
    await waitFor(() => expect(window.location.hash).toBe('#/library/sub/sub_research'));
    const issues = await screen.findByRole('list', { name: '往期' });
    await waitFor(() => expect(within(issues).getAllByRole('button')).toHaveLength(1));
  });
});

describe('Library on mobile', () => {
  it('#/library shows Recent and All thumbnails, subscriptions, and Recently Deleted, all openable', async () => {
    await open('#/library', 390);
    await screen.findByRole('heading', { level: 1, name: '资料库' });
    expect(await screen.findByRole('region', { name: '最近' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '新空间：跟 Plasticine 说' })).toBeTruthy();
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
