import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webHash } from '../../../src/state/web-tabs.ts';
import type { WebPageSnapshot } from '../../../src/api/shared.ts';
import type { NoteView } from '../../../src/api/types.ts';
import { renderApp, seedNote, type AppHarness } from '../../helpers.tsx';

const URL = 'https://example.org/article';
const SNAPSHOT: WebPageSnapshot = { tabId: 'web-page', url: URL, title: '协作中的上下文', text: '保留最初的问题和最新要求。',
  totalChars: 14, truncated: false };

afterEach(() => { delete window.plasticineDesktop; });

async function webPage(snapshot: () => Promise<WebPageSnapshot>): Promise<AppHarness> {
  window.plasticineDesktop = { version: '0.6.0', notify: () => undefined, webTabs: {
    sync: () => undefined, navigate: () => undefined, command: () => undefined, snapshot,
  } };
  const app = await renderApp();
  act(() => {
    window.location.hash = webHash(app.state.webTabs.open(URL, SNAPSHOT.title, 'user'));
    app.state.shellPrefs.setAskPage(true);
  });
  await screen.findByRole('group', { name: '当前页来源' });
  return app;
}

function draft(text: string): void {
  fireEvent.change(screen.getByRole('textbox', { name: '问一句' }), { target: { value: text } });
}

describe('发送前的当前页来源', () => {
  it('笔记显示实际标题、已保存范围和版本，复用笔记缓存并发送对应的结构化引用', async () => {
    const app = await renderApp({ hash: '#/notes/context-note', setup: (fake) => {
      seedNote(fake, 'context-note', '# 用户访谈摘要\n\n第一轮访谈发现的问题。');
      vi.spyOn(fake.api.notes, 'get');
    } });
    fireEvent.click(await screen.findByRole('button', { name: '问这一页' }));
    const source = await screen.findByRole('group', { name: '当前页来源' });
    await within(source).findByText('用户访谈摘要');
    expect(within(source).getByText(/已保存全文.*版本 1/)).toBeTruthy();
    draft('展开第一个问题');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(async () => {
      const messages = (await app.api.lines.read('main', {})).messages;
      expect(messages.some((row) => row.text.includes('〔笔记引用〕')
        && row.text.includes('第一轮访谈发现的问题。'))).toBe(true);
    });
    expect(app.api.notes.get).toHaveBeenCalledTimes(1);
  });

  it('笔记持续读取失败时停在错误状态，同页重画不重读，只有明确重试才再读', async () => {
    const rejectReads: Array<() => void> = [];
    const app = await renderApp({ hash: '#/notes/unread-note', setup: (fake) => {
      seedNote(fake, 'unread-note', '# 暂时读不到的笔记');
      vi.spyOn(fake.api.notes, 'get').mockImplementation(() => new Promise<NoteView>((_resolve, reject) => {
        rejectReads.push(() => reject(new Error('笔记暂时不能读取')));
      }));
    } });
    await waitFor(() => expect(app.api.notes.get).toHaveBeenCalledTimes(1));
    await act(async () => { rejectReads.shift()!(); });
    await screen.findByRole('button', { name: '重新读取笔记' });
    fireEvent.click(screen.getByRole('button', { name: '问这一页' }));
    await waitFor(() => expect(app.api.notes.get).toHaveBeenCalledTimes(2));
    await act(async () => { rejectReads.shift()!(); });
    expect(app.api.notes.get).toHaveBeenCalledTimes(2);
    await screen.findByRole('button', { name: '重试读取当前页' });
    draft('按这一页继续');
    act(() => app.state.shellPrefs.setSidebarCollapsed(true));
    expect(app.api.notes.get).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '重试读取当前页' }));
    await waitFor(() => expect(app.api.notes.get).toHaveBeenCalledTimes(3));
    await act(async () => { rejectReads.shift()!(); });
    expect(app.api.notes.get).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: '重试读取当前页' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: '问一句' }) as HTMLTextAreaElement).value).toBe('按这一页继续');
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('笔记快速切页后迟到的旧正文不替换新来源，发送仍引用当前笔记', async () => {
    let finishFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { finishFirst = resolve; });
    const app = await renderApp({ hash: '#/notes/slow-note', setup: (fake) => {
      seedNote(fake, 'slow-note', '# 第一篇慢笔记\n旧页正文');
      seedNote(fake, 'current-note', '# 当前笔记\n新页正文');
      const get = fake.api.notes.get.bind(fake.api.notes);
      vi.spyOn(fake.api.notes, 'get').mockImplementation(async (id, signal) => {
        if (id === 'slow-note') await firstPending;
        return get(id, signal);
      });
    } });
    fireEvent.click(await screen.findByRole('button', { name: '问这一页' }));
    act(() => {
      window.location.hash = '#/notes/current-note';
    });
    await within(screen.getByRole('group', { name: '当前页来源' })).findByText('当前笔记');
    await act(async () => { finishFirst(); });
    const source = screen.getByRole('group', { name: '当前页来源' });
    expect(within(source).getByText('当前笔记')).toBeTruthy();
    expect(within(source).queryByText('第一篇慢笔记')).toBeNull();
    const send = vi.spyOn(app.api.lines, 'send');
    draft('接着这一页');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![1].quotes?.[0]).toMatchObject({ kind: 'note',
      noteReference: { noteId: 'current-note', version: 1, scope: 'full' } });
    await waitFor(async () => {
      const messages = (await app.api.lines.read('main', {})).messages;
      const sent = messages.find((message) => message.role === 'user' && message.text.includes('接着这一页'));
      expect(sent?.text).toContain('新页正文');
      expect(sent?.text).not.toContain('旧页正文');
    });
  });

  it('读取失败保留草稿且不发送，明确选择仅标题后才发送标题和网址', async () => {
    const snapshot = vi.fn(() => Promise.reject(new Error('网页读取超时')));
    const app = await webPage(snapshot);
    const send = vi.spyOn(app.api.lines, 'send');
    draft('帮我总结');
    expect(await screen.findByText(/没读到这一页的正文/)).toBeTruthy();
    fireEvent.submit(screen.getByRole('textbox', { name: '问一句' }));
    expect(send).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: '问一句' }) as HTMLTextAreaElement).value).toBe('帮我总结');
    fireEvent.click(screen.getByRole('button', { name: '仅引用标题' }));
    expect(within(screen.getByRole('group', { name: '当前页来源' })).getByText('仅标题和链接')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const request = send.mock.calls[0]![1];
    expect(request.quotes?.[0]).toMatchObject({ label: '协作中的上下文',
      text: expect.stringContaining(URL) });
    expect(request.quotes?.[0]).toMatchObject({ text: expect.not.stringContaining(SNAPSHOT.text) });
  });

  it('读取失败可重试，取消当前页引用只移除来源并保留输入', async () => {
    let failing = true;
    await webPage(() => failing ? Promise.reject(new Error('网页读取超时')) : Promise.resolve(SNAPSHOT));
    draft('按这个页面整理');
    await screen.findByRole('button', { name: '重试读取当前页' });
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: '重试读取当前页' }));
    await within(screen.getByRole('group', { name: '当前页来源' })).findByText('可见正文');
    fireEvent.click(screen.getByRole('button', { name: '取消当前页引用' }));
    expect(screen.queryByRole('group', { name: '当前页来源' })).toBeNull();
    expect((screen.getByRole('textbox', { name: '问一句' }) as HTMLTextAreaElement).value).toBe('按这个页面整理');
  });

  it('发送时重新读取期间改了草稿，不清空新文字也不发送旧问题', async () => {
    const snapshot = vi.fn(() => Promise.resolve(SNAPSHOT));
    const app = await webPage(snapshot);
    await within(screen.getByRole('group', { name: '当前页来源' })).findByText('可见正文');
    const send = vi.spyOn(app.api.lines, 'send');
    let finish!: (value: WebPageSnapshot) => void;
    snapshot.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    draft('旧问题');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(finish).toBeDefined());
    draft('改成新问题');
    await act(async () => { finish(SNAPSHOT); });
    expect(send).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: '问一句' }) as HTMLTextAreaElement).value).toBe('改成新问题');
    expect(await screen.findByText(/内容有更新，请再发一次/)).toBeTruthy();
  });

  it('发送前的再次读取失败，正文、已有引用和已上传附件都留在输入框', async () => {
    const snapshot = vi.fn(() => Promise.resolve(SNAPSHOT));
    const app = await webPage(snapshot);
    await within(screen.getByRole('group', { name: '当前页来源' })).findByText('可见正文');
    const send = vi.spyOn(app.api.lines, 'send');
    act(() => app.state.conversationUi.addQuote({ id: 'existing-quote', sourceId: 'source', kind: 'object',
      label: '已有材料', text: '需要一起核对的原文' }));
    fireEvent.change(screen.getByLabelText('选择对话附件'), { target: {
      files: [new File(['补充材料'], '补充.txt', { type: 'text/plain' })],
    } });
    await waitFor(() => expect(app.state.attachments.ready()).toBe(true));
    const files = app.state.attachments.active();
    expect(files).toHaveLength(1);
    draft('结合这些材料总结');
    snapshot.mockRejectedValueOnce(new Error('正文没有读取完成'));
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByRole('button', { name: '重试读取当前页' });
    expect(send).not.toHaveBeenCalled();
    expect(app.state.conversationUi.store.get()).toMatchObject({ draft: '结合这些材料总结',
      quotes: [{ id: 'existing-quote' }] });
    expect(app.state.attachments.active()).toEqual(files);
  });

  it('读取过程中切换来源，不把旧页内容发给新页问题', async () => {
    const snapshot = vi.fn(() => Promise.resolve(SNAPSHOT));
    const app = await webPage(snapshot);
    await within(screen.getByRole('group', { name: '当前页来源' })).findByText('可见正文');
    const send = vi.spyOn(app.api.lines, 'send');
    let finish!: (value: WebPageSnapshot) => void;
    snapshot.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    draft('核对这一页');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(finish).toBeDefined());
    act(() => { window.location.hash = webHash(app.state.webTabs.open('https://example.org/other', '另一页', 'user')); });
    await act(async () => { finish(SNAPSHOT); });
    expect(send).not.toHaveBeenCalled();
    expect(app.state.conversationUi.store.get().draft).toBe('核对这一页');
  });
});
