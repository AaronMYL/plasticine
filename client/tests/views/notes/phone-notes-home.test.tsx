// 手机笔记首层（2026-11-05 设计稿 Phone-Notes）：文件夹一张卡（「Plasticine 写的」是星），最近几篇（AI 写的带 ✦、
// 右边是文件夹）；点文件夹进那个文件夹的列表，点一篇直接打开，列表页头能回首层。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderApp, seedNote } from '../../helpers.tsx';

const NOW = '2026-10-28T08:00:00.000Z';
const EARLIER = '2026-10-27T08:00:00.000Z';

it('文件夹卡 + 最近：AI 写的带 ✦，点文件夹进列表、能回首层，点一篇打开', async () => {
  await renderApp({ width: 390, hash: '#/notes', setup(fake) {
    seedNote(fake, 'mine', '# 周末带爸妈\n\n周六上午人民公园', { folder: '笔记', updatedAt: EARLIER });
    seedNote(fake, 'ai', '# CuaDriver.app 是什么\n\nCua 的 Mac 驱动', { folder: 'Plasticine 写的',
      author: 'ai', updatedAt: NOW });
  } });
  const folders = await screen.findByRole('list', { name: '笔记文件夹' });
  const ai = await within(folders).findByRole('button', { name: /^Plasticine 写的 1/ });
  expect(ai.getAttribute('data-ai')).toBe('true');
  expect(within(folders).getByRole('button', { name: /^全部 2/ })).toBeTruthy();
  const recent = screen.getByRole('region', { name: '最近' });
  const rows = within(recent).getAllByRole('button');
  expect(rows[0]?.textContent).toContain('CuaDriver.app 是什么');
  expect(within(rows[0]!).getByRole('img', { name: 'Plasticine 写的' })).toBeTruthy();
  expect(rows[1]?.textContent).toContain('周末带爸妈');
  expect(within(rows[1]!).queryByRole('img', { name: 'Plasticine 写的' })).toBeNull();

  fireEvent.click(ai);
  expect(await screen.findByRole('searchbox', { name: '搜索笔记' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '回到上一层' }));
  const again = await screen.findByRole('region', { name: '最近' });
  fireEvent.click(within(again).getAllByRole('button')[1]!);
  await waitFor(() => expect(window.location.hash).toBe('#/notes/mine'));
});
