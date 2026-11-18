// 资料库导入导出（11-18 设计稿 Library / Menus / ExportDialog / Phone）：资料库「更多操作」里「导入…」，空间的「⋯」
// 里「导出…」，多选浮条上「导出」；导出弹框一行格式分段，记住上次选的；网页导出是一个离线能开的文件，带着原样的空间。
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpaceView } from '../../../src/api/shared.ts';
import { spaceExportHtml } from '../../../src/views/spaces/space-export-page.ts';
import { renderApp, setViewportWidth } from '../../helpers.tsx';

const saved: string[] = [];
beforeEach(() => {
  saved.length = 0;
  localStorage.clear();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:saved'), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'plasticineDesktop');
});

async function openLibrary(width = 1440) {
  setViewportWidth(width);
  return renderApp({ hash: '#/library', width, setup: (fake) => fake.control.spaces.seed() });
}

async function moreMenu(): Promise<HTMLElement> {
  fireEvent.click((await screen.findAllByRole('button', { name: '更多操作' }))[0]!);
  return screen.findByRole('menu', { name: '更多操作' });
}

function exportDialog(): HTMLElement {
  return screen.getByRole('dialog', { name: /^导出/ });
}

describe('资料库导入导出', () => {
  it('「更多操作」里「导入…」：每个文件一个报告，底部能撤销，没导入的列在顶上', async () => {
    const app = await openLibrary();
    const before = (await app.api.spaces.list()).spaces.length;
    const menu = await moreMenu();
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['选择', '导入…']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: '导入…' }));
    const input = screen.getByLabelText<HTMLInputElement>('选要导入资料库的文件');
    Object.defineProperty(input, 'files', { configurable: true,
      value: [new File(['# 季度复盘\n\n这一季做了不少'], '复盘.md'), new File(['x'], '扫描件.pdf')] });
    fireEvent.change(input);
    expect(await screen.findByText('已导入 1 篇到「报告」')).toBeTruthy();
    expect(screen.getByText('「扫描件.pdf」：只收 Markdown、TXT、Word（.docx）和网页文件')).toBeTruthy();
    expect((await app.api.spaces.list()).spaces.length).toBe(before + 1);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(async () => expect((await app.api.spaces.list()).spaces.length).toBe(before));
  });

  it('卡片的「⋯」里「导出…」：弹框一行五种格式，选 Word 导出，下次打开还是 Word', async () => {
    const app = await openLibrary();
    const exportFiles = vi.spyOn(app.api.spaces, 'exportFiles');
    fireEvent.click((await screen.findAllByRole('button', { name: '「街角咖啡馆靠什么活下来」的更多操作' })).at(-1)!);
    const menu = await screen.findByRole('menu', { name: '「街角咖啡馆靠什么活下来」的更多操作' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['改名', '导出…', '删除']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: '导出…' }));
    const dialog = exportDialog();
    expect(within(dialog).getByRole('heading').textContent).toBe('导出「街角咖啡馆靠什么活下来」');
    const formats = within(dialog).getByRole('group', { name: '格式' });
    expect(within(formats).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['HTML', 'PDF', 'Markdown', 'Word', '长图']);
    fireEvent.click(within(formats).getByRole('button', { name: 'Word' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '导出' }));
    await waitFor(() => expect(saved).toEqual(['街角咖啡馆靠什么活下来.docx']));
    expect(exportFiles).toHaveBeenCalledWith(['sp_style_research'], 'docx');
    expect(screen.queryByRole('dialog', { name: /^导出/ })).toBeNull();
    fireEvent.click((await screen.findAllByRole('button', { name: '「街角咖啡馆靠什么活下来」的更多操作' })).at(-1)!);
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: '导出…' }));
    expect(within(exportDialog()).getByRole('button', { name: 'Word' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('多选后浮条上「导出」：长图交给本体，几篇打成一个包；在桌面客户端里交给壳出', async () => {
    const app = await openLibrary();
    const render = vi.spyOn(app.api.spaces, 'render');
    fireEvent.click(within(await moreMenu()).getByRole('menuitem', { name: '选择' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择街角咖啡馆靠什么活下来' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择阳台光伏能省一半电费吗' }));
    const bar = screen.getByRole('group', { name: '批量操作' });
    expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual(['移到…', '导出', '删除']);
    fireEvent.click(within(bar).getByRole('button', { name: '导出' }));
    const dialog = exportDialog();
    expect(within(dialog).getByRole('heading').textContent).toBe('导出 2 篇');
    fireEvent.click(within(dialog).getByRole('button', { name: '长图' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '导出 2 篇' }));
    await waitFor(() => expect(saved).toEqual(['Plasticine 资料库（2 篇）.zip']));
    expect(render.mock.calls.map(([input]) => [input.format, input.name]))
      .toEqual([['png', '街角咖啡馆靠什么活下来'], ['png', '阳台光伏能省一半电费吗']]);
    const page = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));
    Object.assign(window, { plasticineDesktop: { render: { page } } });
    fireEvent.click(within(screen.getByRole('group', { name: '批量操作' })).getByRole('button', { name: '导出' }));
    fireEvent.click(within(exportDialog()).getByRole('button', { name: 'PDF' }));
    fireEvent.click(within(exportDialog()).getByRole('button', { name: '导出 2 篇' }));
    await waitFor(() => expect(page).toHaveBeenCalledTimes(2));
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('空间页的「⋯」里「导出…」在删除上面；手机上弹框也在', async () => {
    await renderApp({ hash: '#/books/space/sp_style_research', width: 390,
      setup: (fake) => fake.control.spaces.seed() });
    fireEvent.click(await screen.findByRole('button', { name: '「街角咖啡馆靠什么活下来」的更多操作' }));
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent);
    expect(items.slice(-2)).toEqual(['导出…', '删除']);
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '导出…' }));
    expect(exportDialog()).toBeTruthy();
  });
});

describe('导出的网页', () => {
  const space = (html: string | null, genre: SpaceView['genre']) => ({ id: 's1', title: '周报 <一>', html, genre,
    createdAt: '2026-11-18T02:00:00.000Z' }) as SpaceView;

  it('一个完整的网页：同一套版式、插图换成 data: 地址、带着原样的空间；不用等字体就显示', async () => {
    const html = '<header class="rp-hero"><h1 class="rp-h1">周报</h1></header><section class="rp-sec">'
      + '<p>正文</p><img src="/v2/notes/assets/a.png" alt="图"></section>';
    const read = vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    const page = await spaceExportHtml(space(html, 'report'), read);
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('<title>周报 &lt;一&gt;</title>');
    expect(page).toContain('src="data:image/png;base64,AQID"');
    expect(page).not.toContain('data-pz-asset="');
    expect(page).toContain('<body class="pz-report">');
    const marker = /<script type="application\/json" id="plasticine-space">(.*?)<\/script>/.exec(page)?.[1];
    expect(JSON.parse(marker ?? '{}')).toEqual({ title: '周报 <一>', genre: 'report', html });
    expect(read).toHaveBeenCalledWith('/v2/notes/assets/a.png');
  });

  it('旧版式的空间出不了网页，说清楚怎么办', async () => {
    await expect(spaceExportHtml(space(null, null), vi.fn())).rejects.toThrow(/旧版式，先让 Plasticine 重排一次/);
  });
});
