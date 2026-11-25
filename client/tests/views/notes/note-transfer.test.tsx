import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, seedNote, setViewportWidth } from '../../helpers.tsx';

const saved: { name: string; blob: Blob }[] = [];
beforeEach(() => {
  saved.length = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:saved'), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: new Blob() });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pick(files: File[]): void {
  const input = screen.getByLabelText<HTMLInputElement>('选要导入的笔记文件');
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  fireEvent.change(input);
}

async function openMore(): Promise<HTMLElement> {
  fireEvent.click((await screen.findAllByRole('button', { name: '更多操作' }))[0]!);
  return screen.findByRole('menu', { name: '更多操作' });
}

describe('Note import and export', () => {
  it('More -> Import adds files to current folder with undo and lists failed files at top', async () => {
    const app = await renderApp({ hash: '#/notes', width: 1440, setup: (fake) => seedNote(fake, 'n1', '# 已有的') });
    const menu = await openMore();
    const items = within(menu).getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['选择', '导入…']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: '导入…' }));
    pick([new File(['# 周末计划\n\n去西湖'], '周末.md'), new File(['一行\n两行'], '随手记.txt'),
      new File(['a,b'], '表格.csv')]);
    expect(await screen.findByText('已导入 2 篇到「笔记」')).toBeTruthy();
    expect(await screen.findByRole('button', { name: '《周末计划》的操作' })).toBeTruthy();
    expect(screen.getByText('有 1 个文件没导入')).toBeTruthy();
    expect(screen.getByText('「表格.csv」：不是 .md 或 .txt 文件')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(async () => expect((await app.api.notes.list({})).map((note) => note.title)).toEqual(['已有的']));
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByText('有 1 个文件没导入')).toBeNull();
  });

  it('row menu Export downloads .md and multi-select bar Export downloads bundle', async () => {
    await renderApp({ hash: '#/notes', width: 1440, setup: (fake) => {
      seedNote(fake, 'n1', '# 周末计划');
      seedNote(fake, 'n2', '# 周报');
    } });
    fireEvent.click(await screen.findByRole('button', { name: '《周末计划》的操作' }));
    fireEvent.click(await screen.findByRole('button', { name: '导出' }));
    await waitFor(() => expect(saved.map((file) => file.name)).toEqual(['周末计划.md']));
    const menu = await openMore();
    fireEvent.click(within(menu).getByRole('menuitem', { name: '选择' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }));
    const bar = screen.getByRole('group', { name: '批量操作' });
    expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual(['移到…', '导出', '删除']);
    fireEvent.click(within(bar).getByRole('button', { name: '导出' }));
    await waitFor(() => expect(saved.at(-1)?.name).toBe('Plasticine 笔记（2 篇）.zip'));
  });

  it('mobile folder view also provides Import into current folder', async () => {
    setViewportWidth(390);
    await renderApp({ hash: '#/notes', width: 390, setup: (fake) => seedNote(fake, 'n1', '# 周末计划',
      { folder: '生活' }) });
    const folders = await screen.findByRole('list', { name: '笔记文件夹' });
    fireEvent.click(await within(folders).findByRole('button', { name: /^生活 1/ }));
    const menu = await openMore();
    fireEvent.click(within(menu).getByRole('menuitem', { name: '导入…' }));
    pick([new File(['# 读书笔记'], '读书.md')]);
    expect(await screen.findByText('已导入 1 篇到「生活」')).toBeTruthy();
  });

  it('shows gray missing-image placeholder for unreadable image and renders readable image normally', async () => {
    await renderApp({ hash: '#/notes/n1', width: 1440, setup: (fake) => seedNote(fake, 'n1',
      '# 导入的\n\n![截图](assets/missing.png)') });
    const image = await waitFor(() => {
      const found = document.querySelector<HTMLImageElement>('.note-image img');
      if (found === null) throw new Error('图还没画出来');
      return found;
    });
    fireEvent.error(image);
    expect(await screen.findByText('图片没带进来：assets/missing.png')).toBeTruthy();
    expect(image.hidden).toBe(true);
    fireEvent.load(image);
    expect(screen.getByText('图片没带进来：assets/missing.png').hidden).toBe(true);
  });
});
