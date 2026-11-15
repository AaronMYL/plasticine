// 电脑上的笔记文件夹（11-15 界面统一，Aaron 弹框定「两栏合成一栏」）：第二栏就是笔记列表，文件夹从列表顶上的
// 文件夹名（「选择文件夹」）点开，是贴着它的一个弹层。

import { fireEvent, screen } from '@testing-library/react';

/** 笔记栏目的第二栏（列表）。 */
export function noteColumn(): HTMLElement {
  return screen.getByRole('complementary', { name: '笔记' });
}

/** 点开文件夹列表（已经开着就用开着的），返回那个弹层。 */
export async function openFolders(): Promise<HTMLElement> {
  const open = screen.queryByRole('dialog', { name: '文件夹' });
  if (open !== null) return open;
  fireEvent.click(await screen.findByRole('button', { name: '选择文件夹' }));
  return screen.findByRole('dialog', { name: '文件夹' });
}
