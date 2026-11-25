import { fireEvent, screen } from '@testing-library/react';

export function noteColumn(): HTMLElement {
  return screen.getByRole('complementary', { name: '笔记' });
}

export async function openFolders(): Promise<HTMLElement> {
  const open = screen.queryByRole('dialog', { name: '文件夹' });
  if (open !== null) return open;
  fireEvent.click(await screen.findByRole('button', { name: '选择文件夹' }));
  return screen.findByRole('dialog', { name: '文件夹' });
}
