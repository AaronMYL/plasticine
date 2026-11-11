import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../helpers.tsx';

const TITLE = '普通人做指数定投的三个误区';

async function open(width = 1440) {
  const app = await renderApp({ hash: '#/feed', width });
  if (width < 768) fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const area = width < 768 ? await screen.findByRole('dialog', { name: '筛选' })
    : screen.getByRole('complementary', { name: '信息流' });
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
