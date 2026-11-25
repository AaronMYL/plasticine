import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderApp, seedNote, memoryStorage, HOME_HEADING } from '../../helpers.tsx';

it('mobile restores non-first note across Home switch and returns to top folder+recent view', async () => {
  const storage = memoryStorage();
  const setup = (fake: Parameters<typeof seedNote>[0]): void => {
    seedNote(fake, 'first', '# 首篇\n\n第一篇正文');
    seedNote(fake, 'second', '# 读到这里\n\n第二篇正文');
  };
  const app = await renderApp({ width: 390, hash: '#/notes/second', storage, setup });
  await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toContain('第二篇正文'));
  const navigation = screen.getByRole('navigation', { name: '主导航' });
  fireEvent.click(within(navigation).getByRole('button', { name: '首页' }));
  await screen.findByRole('heading', { level: 1, name: HOME_HEADING });
  fireEvent.click(within(navigation).getByRole('button', { name: '笔记' }));
  await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toContain('第二篇正文'));
  fireEvent.click(screen.getByRole('button', { name: '返回笔记列表' }));
  await waitFor(() => expect(screen.getByRole('list', { name: '笔记文件夹' })).toBeTruthy());
  app.view.unmount();
  await renderApp({ width: 390, hash: '#/notes', storage, setup });
  expect(screen.getByRole('list', { name: '笔记文件夹' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: /^全部 / }));
  expect(await screen.findByRole('searchbox', { name: '搜索笔记' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '回到上一层' }));
  expect(await screen.findByRole('list', { name: '笔记文件夹' })).toBeTruthy();
});

it('initial body and list failures retry independently without misreporting empty notes', async () => {
  await renderApp({ width: 390, hash: '#/notes/again', setup(fake) {
    seedNote(fake, 'again', '# 重试以后读到的笔记');
    vi.spyOn(fake.api.notes, 'get').mockRejectedValueOnce(new Error('正文暂时断开'));
    vi.spyOn(fake.api.notes, 'list').mockRejectedValueOnce(new Error('列表暂时断开'));
  } });
  fireEvent.click(await screen.findByRole('button', { name: '再读一次笔记' }));
  await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toContain('重试以后读到的笔记'));
  fireEvent.click(screen.getByRole('button', { name: '返回笔记列表' }));
  expect(screen.queryByText('还没有笔记。')).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: '再读一次列表' }));
  expect(await screen.findByRole('button', { name: /重试以后读到的笔记/ })).toBeTruthy();
});

