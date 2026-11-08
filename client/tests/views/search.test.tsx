// ⌘K 全局切换（11-07 设计稿 Palette）的完整操作路径：统一索引查得到私密笔记全文、对话，删掉的不出；结果按组列、点了
// 直达；输入法选词时不查；新查询取消旧请求；↑↓ 选、↵ 打开、Esc 收起；「让 Plasticine 做」把这句话放进对话框。

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SearchResponse } from '../../src/api/shared.ts';
import { renderApp, sayInMain } from '../helpers.tsx';

async function openPalette(): Promise<HTMLElement> {
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  return screen.findByRole('dialog', { name: '搜索和切换' });
}

function type(panel: HTMLElement, text: string): HTMLElement {
  const input = within(panel).getByRole('combobox', { name: '搜索和切换' });
  fireEvent.change(input, { target: { value: text } });
  return input;
}

const response = (id: string, title: string): SearchResponse => ({
  results: [{ kind: 'note', id, title, excerpt: title, detail: '笔记', updatedAt: '2026-10-27T02:00:00.000Z' }],
  total: 1, nextCursor: null, asOf: '2026-10-27T02:00:00.000Z', scanned: 1, elapsedMs: 1,
});

describe('⌘K 全局切换', () => {
  it('底下只提示做得到的：↑↓ 选、↵ 打开；没有分屏就不提「⌘↵ 在旁边打开」', async () => {
    await renderApp();
    const panel = await openPalette();
    expect(panel.textContent).toContain('打开');
    expect(panel.textContent).not.toContain('在旁边打开');
    expect(panel.textContent).not.toContain('⌘↵');
  });

  it('查得到私密笔记全文，删掉的不出；点一条直达并收起', async () => {
    await renderApp({ setup: ({ control }) => {
      control.notes.seed({ id: 'glacier', markdown: '# 旅行记录\n' + '前文'.repeat(200) + '冰川路线' });
      control.notes.seed({ id: 'secret', markdown: '# 冰川私密', private: true });
      control.notes.seed({ id: 'deleted', markdown: '# 冰川删除', deletedAt: '2026-10-27T01:00:00.000Z' });
    } });
    const panel = await openPalette();
    type(panel, '冰川');
    const result = await within(panel).findByRole('option', { name: /旅行记录/ });
    expect(within(panel).getByRole('option', { name: /冰川私密/ })).toBeTruthy();
    expect(panel.textContent).not.toContain('冰川删除');
    expect(panel.textContent).toContain('笔记');
    fireEvent.click(result);
    await waitFor(() => expect(window.location.hash).toBe('#/notes/glacier'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '搜索和切换' })).toBeNull());
  });

  it('查到私密正文后直接打开笔记，不请求解锁', async () => {
    const app = await renderApp({ setup: (fake) => {
      fake.control.notes.seed({ id: 'private-hit', markdown: '# 私密行程\n\n只有正文写着雾凇路线', private: true });
      vi.spyOn(fake.api.signed, 'send');
    } });
    const panel = await openPalette();
    type(panel, '雾凇路线');
    fireEvent.click(await within(panel).findByRole('option', { name: /私密行程/ }));
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toContain('只有正文写着雾凇路线'));
    expect(screen.queryByRole('button', { name: /解锁/ })).toBeNull();
    expect(app.api.signed.send).not.toHaveBeenCalled();
  });

  it('中文输入法选词时不发起搜索，完成后才查找', async () => {
    const app = await renderApp();
    const query = vi.spyOn(app.api.search, 'query');
    const panel = await openPalette();
    const input = within(panel).getByRole('combobox', { name: '搜索和切换' });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '冰川' } });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(query).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
  });

  it('新查询取消旧请求，迟到的响应不能覆盖当前结果', async () => {
    const app = await renderApp();
    let finishOld!: (value: SearchResponse) => void;
    const pending = new Promise<SearchResponse>((resolve) => { finishOld = resolve; });
    const query = vi.spyOn(app.api.search, 'query').mockReturnValueOnce(pending)
      .mockResolvedValueOnce(response('new', '新查询结果'));
    const panel = await openPalette();
    type(panel, '旧查询');
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    const signal = query.mock.calls[0]?.[1];
    type(panel, '新查询');
    await within(panel).findByRole('option', { name: /新查询结果/ });
    expect(signal?.aborted).toBe(true);
    await act(async () => { finishOld(response('old', '旧查询结果')); });
    expect(within(panel).queryByRole('option', { name: /旧查询结果/ })).toBeNull();
  });

  it('↓ 选下一条、↵ 打开；Esc 收起', async () => {
    await renderApp({ setup: ({ control }) => {
      control.notes.seed({ id: 'a1', markdown: '# 雪线甲' });
      control.notes.seed({ id: 'a2', markdown: '# 雪线乙' });
    } });
    let panel = await openPalette();
    const input = type(panel, '雪线');
    await within(panel).findByRole('option', { name: /雪线乙/ });
    const options = within(panel).getAllByRole('option');
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(within(panel).getAllByRole('option')[1]?.getAttribute('aria-selected')).toBe('true');
    const second = within(panel).getAllByRole('option')[1]!.textContent ?? '';
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(window.location.hash).toBe(second.includes('甲') ? '#/notes/a1' : '#/notes/a2'));
    panel = await openPalette();
    fireEvent.keyDown(panel, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '搜索和切换' })).toBeNull());
  });

  it('主线里的回答：首行作标题，正文深处也能命中；点了去主线那一句', async () => {
    const app = await renderApp();
    sayInMain(app, 'assistant', `先核对路线\n${'开头'.repeat(300)}海拔需要核实`);
    const panel = await openPalette();
    type(panel, '海拔');
    fireEvent.click(await within(panel).findByRole('option', { name: /先核对路线/ }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/plasticine\/line%3Aline-main%3A\d+$/));
  });

  it('最后一组「让 Plasticine 做」：这句话放进对话框的输入框，对话框展开', async () => {
    const app = await renderApp({ width: 1000 });
    const panel = await openPalette();
    type(panel, '新建一份周报订阅');
    fireEvent.click(within(panel).getByRole('option', { name: /「新建一份周报订阅」/ }));
    await waitFor(() => expect(app.state.conversationUi.store.get().draft).toBe('新建一份周报订阅'));
    expect(app.state.shellPrefs.store.get().chatOpen).toBe(true);
  });
});
