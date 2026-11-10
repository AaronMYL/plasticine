import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { WebPageTool } from '../../src/api/shared.ts';
import { webHash } from '../../src/state/web-tabs.ts';
import { renderApp } from '../helpers.tsx';

const URL = 'https://example.com/walk';
function bridge(text = '先沿河走，再进公园。\n回程走另一条路。') {
  const tools = vi.fn(async (_id: string, tool: WebPageTool) => tool.kind === 'extract_images' ? [] : { marked: 2 });
  window.plasticineDesktop = { version: '0.5.0', notify: vi.fn(), webTabs: { sync: vi.fn(), command: vi.fn(),
    navigate: vi.fn(), tools: ['extract_marks', 'extract_images'], tool: tools,
    snapshot: vi.fn(async (tabId: string) => ({ tabId, url: URL, title: '城市散步', text,
      totalChars: text.length, truncated: false })) } };
  return tools;
}
afterEach(() => { delete window.plasticineDesktop; vi.restoreAllMocks(); });
async function open() {
  const app = await renderApp();
  act(() => { window.location.hash = webHash(app.state.webTabs.open(URL, '城市散步', 'user')); });
  fireEvent.click(await screen.findByRole('button', { name: '提取' }));
  return app;
}

it('提取后标原文、去掉一条就更新标记；点击重点定位，归档到同一空间的新版本', async () => {
  const tools = bridge();
  const app = await open();
  const panel = await screen.findByRole('complementary', { name: '网页重点' });
  await within(panel).findByText('提取到 2 条');
  fireEvent.click(within(panel).getByRole('button', { name: '先沿河走，再进公园。' }));
  await waitFor(() => expect(tools).toHaveBeenCalledWith(expect.any(String),
    expect.objectContaining({ kind: 'extract_marks', focus: 0 })));
  fireEvent.click(within(panel).getAllByRole('button', { name: '去掉这条重点' })[1]!);
  expect(within(panel).getByText('提取到 1 条')).toBeTruthy();
  fireEvent.click(within(panel).getByRole('button', { name: '归档到资料库' }));
  await within(panel).findByRole('button', { name: '打开归档' });
  const pages = await app.api.spaces.list();
  expect(pages.spaces.filter((space) => space.category === 'webarchive')).toHaveLength(1);
});

it('读不到正文会如实提示，不能归档；离开时移除原文高亮', async () => {
  const tools = bridge('');
  await open();
  const panel = await screen.findByRole('complementary', { name: '网页重点' });
  expect((await within(panel).findByRole('alert')).textContent).toContain('正文');
  expect(within(panel).queryByRole('button', { name: '归档到资料库' })).toBeNull();
  fireEvent.click(within(panel).getByRole('button', { name: '收起网页重点' }));
  await waitFor(() => expect(tools).toHaveBeenCalledWith(expect.any(String), { kind: 'extract_marks', points: [] }));
});
