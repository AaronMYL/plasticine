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

describe('Cmd+K global switcher', () => {
  it('footer shows only available shortcuts and omits split-view shortcut when unsupported', async () => {
    await renderApp();
    const panel = await openPalette();
    expect(panel.textContent).toContain('打开');
    expect(panel.textContent).not.toContain('在旁边打开');
    expect(panel.textContent).not.toContain('⌘↵');
  });

  it('searches full note text excluding deleted notes and navigates directly on click', async () => {
    await renderApp({ setup: ({ control }) => {
      control.notes.seed({ id: 'glacier', markdown: '# 旅行记录\n' + '前文'.repeat(200) + '冰川路线' });
      control.notes.seed({ id: 'second', markdown: '# 冰川另一篇' });
      control.notes.seed({ id: 'deleted', markdown: '# 冰川删除', deletedAt: '2026-10-27T01:00:00.000Z' });
    } });
    const panel = await openPalette();
    type(panel, '冰川');
    const result = await within(panel).findByRole('option', { name: /旅行记录/ });
    expect(within(panel).getByRole('option', { name: /冰川另一篇/ })).toBeTruthy();
    expect(panel.textContent).not.toContain('冰川删除');
    expect(panel.textContent).toContain('笔记');
    fireEvent.click(result);
    await waitFor(() => expect(window.location.hash).toBe('#/notes/glacier'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '搜索和切换' })).toBeNull());
  });

  it('opens matched note directly without requesting unlock', async () => {
    const app = await renderApp({ setup: (fake) => {
      fake.control.notes.seed({ id: 'body-hit', markdown: '# 冬天行程\n\n只有正文写着雾凇路线' });
      vi.spyOn(fake.api.signed, 'send');
    } });
    const panel = await openPalette();
    type(panel, '雾凇路线');
    fireEvent.click(await within(panel).findByRole('option', { name: /冬天行程/ }));
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toContain('只有正文写着雾凇路线'));
    expect(screen.queryByRole('button', { name: /解锁/ })).toBeNull();
    expect(app.api.signed.send).not.toHaveBeenCalled();
  });

  it('defers search during Chinese IME composition until committed', async () => {
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

  it('cancels stale query so late response cannot overwrite newer results', async () => {
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

  it('Down selects next item, Enter opens it, and Esc closes switcher', async () => {
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

  it('matches main thread replies deep in body using first line as title and jumps to that message', async () => {
    const app = await renderApp();
    sayInMain(app, 'assistant', `先核对路线\n${'开头'.repeat(300)}海拔需要核实`);
    const panel = await openPalette();
    type(panel, '海拔');
    fireEvent.click(await within(panel).findByRole('option', { name: /先核对路线/ }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/plasticine\/line%3Aline-main%3A\d+$/));
  });

  it('Ask Plasticine group puts query into chat input and expands chat box', async () => {
    const app = await renderApp({ width: 1000 });
    const panel = await openPalette();
    type(panel, '新建一份周报订阅');
    fireEvent.click(within(panel).getByRole('option', { name: /「新建一份周报订阅」/ }));
    await waitFor(() => expect(app.state.conversationUi.store.get().draft).toBe('新建一份周报订阅'));
    expect(app.state.shellPrefs.store.get().chatOpen).toBe(true);
  });
});
