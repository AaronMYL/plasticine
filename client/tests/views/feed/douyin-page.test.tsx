import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../helpers.tsx';

const TITLE = '普通人做指数定投的三个误区';

async function open(width = 1440) {
  const app = await renderApp({ hash: '#/feed', width });
  if (width < 768) fireEvent.click(screen.getByRole('button', { name: '管理来源' }));
  const area = width < 768 ? await screen.findByRole('dialog', { name: '管理来源' })
    : screen.getByRole('complementary', { name: '阅读' });
  fireEvent.click(await within(area).findByRole('button', { name: /^抖音收藏/ }));
  return app;
}

describe('抖音收藏空间阅读', () => {
  it('电脑选中作品展示关联空间，资料库改版后立即读取新版，不重复解析', async () => {
    const app = await open();
    const process = vi.spyOn(app.api.feed, 'douyinProcess');
    const frame = await screen.findByTitle(TITLE);
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('srcdoc')).toContain('逐字稿');
    const list = await app.api.feed.douyin({});
    const spaceId = list.works[0]!.spaceId!;
    const original = await app.api.spaces.get(spaceId);
    await act(async () => {
      await app.api.spaces.save(spaceId, { requestId: 'update-linked-space', version: original.version,
        html: '<h1>收藏的这份报告已经改成最新内容。</h1>' });
    });
    await waitFor(() => expect(frame.getAttribute('srcdoc')).toContain('已经改成最新内容'));
    expect(screen.getByText('空间 · 第 2 版')).toBeTruthy();
    expect(process).not.toHaveBeenCalled();
  });

  it('手机先显示收藏列表，点开和返回都保留同一份空间关联', async () => {
    await open(390);
    await screen.findByRole('region', { name: '抖音收藏列表' });
    expect(screen.queryByTitle(TITLE)).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${TITLE}`) }));
    await screen.findByTitle(TITLE);
    fireEvent.click(screen.getByRole('button', { name: '返回收藏列表' }));
    expect(screen.queryByTitle(TITLE)).toBeNull();
    expect(screen.getByRole('region', { name: '抖音收藏列表' })).toBeTruthy();
  });
});

it('没有真实收藏时间只显示作者；有时间才出现收藏日期，不用同步时间补齐', async () => {
  const app = await open();
  const list = await app.api.feed.douyin({});
  const missing = list.works.find((work) => work.collectedAt === null)!;
  const dated = list.works.find((work) => work.collectedAt !== null)!;
  const absentRow = await screen.findByRole('button', { name: new RegExp(`^${missing.title}`) });
  const datedRow = await screen.findByRole('button', { name: new RegExp(`^${dated.title}`) });
  expect(absentRow.textContent).toContain(missing.author);
  expect(absentRow.textContent).not.toContain('收藏于');
  expect(datedRow.textContent).toContain('收藏于');
  const firstBefore = absentRow.textContent;
  await act(async () => { await app.api.feed.douyinSync({ requestId: 'date-display-sync' }); });
  await waitFor(() => expect(absentRow.textContent).toBe(firstBefore));
});

describe('抖音收藏整理', () => {
  it('分段按整理到哪了筛；「整理几条」勾选没整理的，一次交出去', async () => {
    const app = await open();
    const process = vi.spyOn(app.api.feed, 'douyinProcess');
    const list = await screen.findByRole('region', { name: '抖音收藏列表' });
    await within(list).findByRole('button', { name: new RegExp(`^${TITLE}`) });
    const works = (await app.api.feed.douyin({})).works;
    const todo = works.filter((work) => work.stage !== 'summarized' && !['queued', 'running', 'waiting_mac']
      .includes(work.run));
    const filters = within(list).getByRole('group', { name: '整理到哪了' });
    fireEvent.click(within(filters).getByRole('button', { name: /^已整理/ }));
    const done = (await app.api.feed.douyin({ phase: 'done' })).works;
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(done.length));
    fireEvent.click(within(filters).getByRole('button', { name: /^全部/ }));
    fireEvent.click(within(list).getByRole('button', { name: '整理几条' }));
    if (todo.length === 0) return;
    fireEvent.click(await within(list).findByRole('checkbox', { name: `选「${todo[0]!.title}」` }));
    fireEvent.click(within(list).getByRole('button', { name: '整理这 1 条' }));
    await waitFor(() => expect(process).toHaveBeenCalledWith(expect.objectContaining({ ids: [todo[0]!.id] })));
  });

  it('有封面画封面，封面打不开退回播放符号；标题最多两行', async () => {
    await open();
    const list = await screen.findByRole('region', { name: '抖音收藏列表' });
    const row = await within(list).findByRole('button', { name: new RegExp(`^${TITLE}`) });
    const image = row.querySelector('.dy-work-thumb img');
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    await waitFor(() => expect(row.querySelector('.dy-work-thumb img')).toBeNull());
    expect(row.querySelector('.dy-work-thumb svg')).not.toBeNull();
  });
});

describe('抖音收藏的三个数和接着读', () => {
  const observers: { callback: IntersectionObserverCallback; elements: Element[] }[] = [];
  class StubObserver {
    readonly entry: { callback: IntersectionObserverCallback; elements: Element[] };
    constructor(callback: IntersectionObserverCallback) {
      this.entry = { callback, elements: [] };
      observers.push(this.entry);
    }
    observe(element: Element): void { this.entry.elements.push(element); }
    unobserve(): void {}
    disconnect(): void { this.entry.elements = []; }
    takeRecords(): IntersectionObserverEntry[] { return []; }
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    observers.length = 0;
  });
  const reachBottom = (list: HTMLElement): void => {
    for (const entry of observers) {
      const inside = entry.elements.filter((element) => list.contains(element));
      if (inside.length === 0) continue;
      entry.callback(inside.map((target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry),
        {} as IntersectionObserver);
    }
  };

  it('全部 / 没整理 / 已整理按全部收藏数；已整理的排得再靠后也筛得出来', async () => {
    await open();
    const list = await screen.findByRole('region', { name: '抖音收藏列表' });
    const filters = within(list).getByRole('group', { name: '整理到哪了' });
    await waitFor(() => expect(within(filters).getByRole('button', { name: /^全部/ }).textContent).toContain('1434'));
    expect(within(filters).getByRole('button', { name: /^没整理/ }).textContent).toContain('1431');
    expect(within(filters).getByRole('button', { name: /^已整理/ }).textContent).toContain('3');
    fireEvent.click(within(filters).getByRole('button', { name: /^已整理/ }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
  });

  it('滚到底自动接着读，不用点「更多收藏」', async () => {
    vi.stubGlobal('IntersectionObserver', StubObserver);
    const app = await open();
    const fetch = vi.spyOn(app.api.feed, 'douyin');
    const list = await screen.findByRole('region', { name: '抖音收藏列表' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(50));
    expect(within(list).queryByRole('button', { name: '更多收藏' })).toBeNull();
    act(() => reachBottom(list));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(100));
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ offset: 50 }));
  });
});

describe('本地转写没装时先问一句', () => {
  const WAITING = '城市骑行路线推荐';

  it('在等转写的视频标「等转写装好」，点开是安装卡；点安装后台装好，接着整理', async () => {
    const app = await open();
    const install = vi.spyOn(app.api.feed, 'installTranscriber');
    const list = await screen.findByRole('region', { name: '抖音收藏列表' });
    const row = await within(list).findByRole('button', { name: new RegExp(`^${WAITING}`) });
    expect(row.textContent).toContain('等转写装好');
    fireEvent.click(row);
    const card = await screen.findByRole('region', { name: '本地转写' });
    expect(within(card).getByRole('heading', { name: '解析视频要先装本地转写' })).toBeTruthy();
    expect(card.textContent).toContain('约 220 MB');
    fireEvent.click(within(card).getByRole('button', { name: '安装' }));
    await waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('region', { name: '本地转写' })).toBeNull());
    await waitFor(() => expect(within(list).getByRole('button', { name: new RegExp(`^${WAITING}`) }).textContent)
      .toContain('在整理'));
  });

  it('没整理的视频点「处理作品」先问；点「先不」不处理、不下视频', async () => {
    const app = await open();
    const process = vi.spyOn(app.api.feed, 'douyinProcess');
    const list = await screen.findByRole('region', { name: '抖音收藏列表' });
    const works = (await app.api.feed.douyin({})).works;
    const todo = works.find((work) => work.kind === 'video' && work.stage !== 'summarized' && work.run === 'idle')!;
    fireEvent.click(await within(list).findByRole('button', { name: new RegExp(`^${todo.title}`) }));
    fireEvent.click(await screen.findByRole('button', { name: '处理作品' }));
    const card = await screen.findByRole('region', { name: '本地转写' });
    fireEvent.click(within(card).getByRole('button', { name: '先不' }));
    expect(screen.queryByRole('region', { name: '本地转写' })).toBeNull();
    expect(process).not.toHaveBeenCalled();
  });
});
