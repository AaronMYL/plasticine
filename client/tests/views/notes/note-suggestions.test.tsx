// 续写和补充各管各的（2026-11-04 用户定）：两个都开时各有计时器、请求和显示位，一个出现不清掉另一个。
// 2026-11-09 他定重做：续写停下就有、边生成边画、边打边吃（对不上才撤下）；补充光标停在段尾约 3 秒给一次，同一段只给
// 一次（内容没变不再给，换段或这段又写了新内容算新的一次）；中文输入法组字期间不改正文也不改装饰，组完按提交的字比。

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import type { NoteAssistRequest, NoteAssistView } from '../../../src/api/shared.ts';
import { NOTE_INTERJECT_PAUSE_MS, NOTE_PREDICT_PAUSE_MS } from '../../../src/views/notes/note-suggestions.tsx';
import { renderApp, seedNote, settle } from '../../helpers.tsx';
import { aiOn, toggleAi } from './ai-switch.ts';

/** 一次补充最长要等这么久：停顿 3 秒再加上假接口和渲染。 */
const INTERJECT_WAIT_MS = NOTE_INTERJECT_PAUSE_MS + 1500;
const PREDICT_WAIT_MS = NOTE_PREDICT_PAUSE_MS + 1500;
const TEST_TIMEOUT_MS = 30_000;
const PARAGRAPH = '我正在把一段经历记下来，想分清实际发生的事和自己的解释。'.repeat(4);

function supplements(text: string): NoteAssistView {
  return { markdown: '', label: '补充建议', suggestions: text === '' ? []
    : [{ kind: 'supplement', text, draft: text }] };
}

async function noteEditor(): Promise<Editor> {
  return waitFor(() => {
    const node = document.querySelector<HTMLElement & { editor?: Editor }>('.note-body .ProseMirror');
    if (node?.editor === undefined) { throw new Error('编辑器尚未就绪'); }
    return node.editor;
  });
}

function ghost(): Element | null {
  return document.querySelector('.note-body .note-ghost');
}

function interjection(): Element | null {
  return document.querySelector('.note-body .note-suggestion');
}

function toggle(name: '续写' | '补充建议'): void {
  toggleAi(name);
}

function turnOff(): void {
  for (const name of ['续写', '补充建议'] as const) {
    if (aiOn(name)) { toggleAi(name); }
  }
}

describe('续写和补充都开', () => {
  it('停 0.4 秒出续写，再停到 3 秒补充也出现，两者同时在；Tab 采用续写，打字清掉两者', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '开头') });
    const editor = await noteEditor();
    const assist = vi.spyOn(app.api.notes, 'assist').mockImplementation(async (_id, input) => (
      input.action === 'predict' ? { markdown: '，续写的一句。', label: '续写' }
        : supplements('要不要补一条证据？')));
    toggle('补充建议');
    act(() => { editor.commands.focus('end'); editor.commands.insertContent(PARAGRAPH); });
    await waitFor(() => expect(ghost()).not.toBeNull(), { timeout: PREDICT_WAIT_MS });
    expect(interjection()).toBeNull();
    await waitFor(() => expect(interjection()).not.toBeNull(), { timeout: INTERJECT_WAIT_MS });
    expect(ghost()?.textContent).toBe('，续写的一句。');
    expect(interjection()?.textContent).toContain('要不要补一条证据？');
    expect(assist.mock.calls.map((call) => call[1].action)).toEqual(['predict', 'interject']);
    fireEvent.keyDown(editor.view.dom, { key: 'Tab' });
    expect(editor.getText()).toContain(`${PARAGRAPH}，续写的一句。`);
    expect(editor.getText()).not.toContain('要不要补一条证据');
    expect(ghost()).toBeNull();
    expect(interjection()).toBeNull();
    turnOff();
  }, TEST_TIMEOUT_MS);

  it('灰字下面有「收下这句」（手机上代替 Tab），点了就采用；工具栏那一行 AI 有名字', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '开头') });
    const editor = await noteEditor();
    vi.spyOn(app.api.notes, 'assist').mockResolvedValue({ markdown: '，续写的一句。', label: '续写' });
    act(() => { editor.commands.focus('end'); editor.commands.insertContent(PARAGRAPH); });
    await waitFor(() => expect(ghost()).not.toBeNull(), { timeout: PREDICT_WAIT_MS });
    expect(within(screen.getByRole('group', { name: '笔记 AI' })).getByRole('switch', { name: '续写' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '收下这句' }));
    expect(editor.getText()).toContain(`${PARAGRAPH}，续写的一句。`);
    expect(ghost()).toBeNull();
    turnOff();
  }, TEST_TIMEOUT_MS);

  it('续写回来得比补充晚也不清掉补充；「加上」只采用补充，这段写了新内容再给一次，Esc 两个一起收起', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '开头') });
    const editor = await noteEditor();
    const slow = Promise.withResolvers<void>();
    vi.spyOn(app.api.notes, 'assist').mockImplementation(async (_id, input) => {
      if (input.action === 'interject') { return supplements('补一句。'); }
      await slow.promise;
      return { markdown: '，续写。', label: '续写' };
    });
    toggle('补充建议');
    act(() => { editor.commands.focus('end'); editor.commands.insertContent(PARAGRAPH); });
    await waitFor(() => expect(interjection()).not.toBeNull(), { timeout: INTERJECT_WAIT_MS });
    expect(ghost()).toBeNull();
    await act(async () => slow.resolve());
    await waitFor(() => expect(ghost()).not.toBeNull());
    expect(interjection()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加上' }));
    fireEvent.click(screen.getByRole('button', { name: '留下' }));
    expect(editor.getText()).toContain('补一句。');
    expect(editor.getText()).not.toContain('，续写。');
    act(() => { editor.commands.focus('end'); editor.commands.insertContent(PARAGRAPH); });
    await waitFor(() => expect(interjection()).not.toBeNull(), { timeout: INTERJECT_WAIT_MS });
    expect(ghost()).not.toBeNull();
    fireEvent.keyDown(editor.view.dom, { key: 'Escape' });
    expect(ghost()).toBeNull();
    expect(interjection()).toBeNull();
    turnOff();
  }, TEST_TIMEOUT_MS);

  it('长笔记中间位置的补充，送去的是光标前后的内容，不是整篇最后一段', async () => {
    const head = `# 开头\n\n${'很早以前写下的背景。'.repeat(700)}`;
    const middle = '光标所在的这一段，正在想下一步怎么验证。';
    const tail = `${'后面早就写好的结论。'.repeat(700)}\n\n全文最后一句。`;
    const app = await renderApp({ hash: '#/notes/n1',
      setup: (fake) => seedNote(fake, 'n1', `${head}\n\n${middle}\n\n${tail}`) });
    const editor = await noteEditor();
    const requests: NoteAssistRequest[] = [];
    vi.spyOn(app.api.notes, 'assist').mockImplementation(async (_id, input) => {
      requests.push(input);
      return { markdown: '', label: '建议' };
    });
    toggle('续写');
    toggle('补充建议');
    let end = 0;
    editor.state.doc.forEach((node, offset) => {
      if (node.textContent === middle) { end = offset + node.nodeSize - 1; }
    });
    expect(end).toBeGreaterThan(0);
    act(() => { editor.chain().focus().setTextSelection(end).insertContent(PARAGRAPH).run(); });
    await waitFor(() => expect(requests.length).toBe(1), { timeout: INTERJECT_WAIT_MS });
    const [request] = requests;
    expect(request?.action).toBe('interject');
    expect(request?.before?.endsWith(`${middle}${PARAGRAPH}`)).toBe(true);
    expect(request?.after).toContain('后面早就写好的结论');
    expect(request?.after).not.toContain(middle);
    expect(request?.before).not.toContain('全文最后一句');
    expect(request?.markdown).toBe(request?.before);
    turnOff();
  }, TEST_TIMEOUT_MS);
});

describe('补充每段只给一次', () => {
  it('没什么可补就不出；同一段内容没变，挪开再回来也不再要；这段写了新内容、换一段才算新的一次', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '开头') });
    const editor = await noteEditor();
    const asked: string[] = [];
    vi.spyOn(app.api.notes, 'assist').mockImplementation(async (_id, input) => {
      asked.push(input.before ?? '');
      return supplements(asked.length === 3 ? '换了一段，要不要先列证据？' : '');
    });
    toggle('续写');
    toggle('补充建议');
    act(() => { editor.commands.focus('end'); editor.commands.insertContent(PARAGRAPH); });
    await waitFor(() => expect(asked.length).toBe(1), { timeout: INTERJECT_WAIT_MS });
    await settle(50);
    expect(interjection()).toBeNull();
    act(() => { editor.commands.setTextSelection(1); });
    act(() => { editor.commands.focus('end'); });
    await settle(NOTE_INTERJECT_PAUSE_MS + 300);
    expect(asked.length).toBe(1);
    act(() => { editor.commands.insertContent('又想到一点'); });
    await waitFor(() => expect(asked.length).toBe(2), { timeout: INTERJECT_WAIT_MS });
    expect(asked[1]?.endsWith('又想到一点')).toBe(true);
    act(() => { editor.commands.splitBlock(); editor.commands.insertContent('新的一段从这里开始写起。'); });
    await waitFor(() => expect(interjection()?.textContent).toContain('换了一段'), { timeout: INTERJECT_WAIT_MS });
    fireEvent.click(screen.getByRole('button', { name: '不用' }));
    act(() => { editor.commands.setTextSelection(1); });
    act(() => { editor.commands.focus('end'); });
    await settle(NOTE_INTERJECT_PAUSE_MS + 300);
    expect(asked.length).toBe(3);
    expect(interjection()).toBeNull();
    turnOff();
  }, TEST_TIMEOUT_MS);

  it('还没回来就被打断（挪开光标）的不算给过：回到这一段、内容没变，还会再要', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '开头') });
    const editor = await noteEditor();
    const signals: AbortSignal[] = [];
    vi.spyOn(app.api.notes, 'assist').mockImplementation(async (_id, _input, signal) => {
      if (signal !== undefined) { signals.push(signal); }
      if (signals.length === 1) {
        await new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason)));
      }
      return supplements('这回给出来了。');
    });
    toggle('续写');
    toggle('补充建议');
    act(() => { editor.commands.focus('end'); editor.commands.insertContent(PARAGRAPH); });
    await waitFor(() => expect(signals.length).toBe(1), { timeout: INTERJECT_WAIT_MS });
    act(() => { editor.commands.setTextSelection(1); });
    expect(signals[0]?.aborted).toBe(true);
    act(() => { editor.commands.focus('end'); });
    await waitFor(() => expect(interjection()?.textContent).toContain('这回给出来了'), { timeout: INTERJECT_WAIT_MS });
    turnOff();
  }, TEST_TIMEOUT_MS);
});

describe('续写边生成边显示、边打边吃', () => {
  it('第一段字到了就画灰字，后面的字接着长出来；最终文字以 done 为准', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '正在记录这段经历') });
    const editor = await noteEditor();
    const rest = Promise.withResolvers<void>();
    vi.spyOn(app.api.notes, 'assistStream').mockImplementation(async (_id, _input, onText) => {
      onText('，然后');
      await rest.promise;
      onText('把事实记清楚。  ');
      return { markdown: '，然后把事实记清楚。', label: '续写' };
    });
    act(() => { editor.commands.focus('end'); });
    await waitFor(() => expect(ghost()?.textContent).toBe('，然后'), { timeout: PREDICT_WAIT_MS });
    await act(async () => rest.resolve());
    await waitFor(() => expect(ghost()?.textContent).toBe('，然后把事实记清楚。'));
    turnOff();
  }, TEST_TIMEOUT_MS);

  it('接着打的字和灰字开头一样：灰字留着、只去掉打出的，不重新要；对不上才撤下，停笔后再要', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '正在记录这段经历') });
    const editor = await noteEditor();
    const stream = vi.spyOn(app.api.notes, 'assistStream').mockImplementation(async (_id, _input, onText) => {
      onText('，然后把事实记清楚。');
      return { markdown: '，然后把事实记清楚。', label: '续写' };
    });
    act(() => { editor.commands.focus('end'); });
    await waitFor(() => expect(ghost()?.textContent).toBe('，然后把事实记清楚。'), { timeout: PREDICT_WAIT_MS });
    act(() => { editor.commands.insertContent('，'); });
    expect(ghost()?.textContent).toBe('然后把事实记清楚。');
    act(() => { editor.commands.insertContent('然后'); });
    expect(ghost()?.textContent).toBe('把事实记清楚。');
    await settle(NOTE_PREDICT_PAUSE_MS + 200);
    expect(stream).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(editor.view.dom, { key: 'Tab' });
    expect(editor.getText()).toBe('正在记录这段经历，然后把事实记清楚。');
    expect(editor.getText().match(/然后/g)?.length).toBe(1);
    act(() => { editor.commands.insertContent('另起'); });
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2), { timeout: PREDICT_WAIT_MS });
    act(() => { editor.commands.insertContent('不对'); });
    expect(ghost()).toBeNull();
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(3), { timeout: PREDICT_WAIT_MS });
    turnOff();
  }, TEST_TIMEOUT_MS);

  it('照着打完了整条灰字：撤下，停笔后再要下一条', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '正在记录这段经历') });
    const editor = await noteEditor();
    const stream = vi.spyOn(app.api.notes, 'assistStream').mockImplementation(async (_id, _input, onText) => {
      onText('，然后');
      return { markdown: '，然后', label: '续写' };
    });
    act(() => { editor.commands.focus('end'); });
    await waitFor(() => expect(ghost()?.textContent).toBe('，然后'), { timeout: PREDICT_WAIT_MS });
    act(() => { editor.commands.insertContent('，然后'); });
    expect(ghost()).toBeNull();
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2), { timeout: PREDICT_WAIT_MS });
    turnOff();
  }, TEST_TIMEOUT_MS);
});

describe('中文输入法组字时', () => {
  it('灰字在时开始组字：不发任何事务，灰字只用 CSS 藏起来；组完提交的字是灰字开头就接着显示剩下的', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '正在记录这段经历') });
    const editor = await noteEditor();
    const stream = vi.spyOn(app.api.notes, 'assistStream').mockImplementation(async (_id, _input, onText) => {
      onText('然后把事实记清楚。');
      return { markdown: '然后把事实记清楚。', label: '续写' };
    });
    act(() => { editor.commands.focus('end'); });
    await waitFor(() => expect(ghost()?.textContent).toBe('然后把事实记清楚。'), { timeout: PREDICT_WAIT_MS });
    await settle(50);
    const body = document.querySelector('.note-body');
    const transactions: boolean[] = [];
    const record = ({ transaction }: { transaction: { docChanged: boolean } }): void => {
      transactions.push(transaction.docChanged);
    };
    editor.on('transaction', record);
    fireEvent.compositionStart(editor.view.dom);
    await settle(50);
    expect(transactions).toEqual([]);
    expect(body?.hasAttribute('data-composing')).toBe(true);
    expect(ghost()).not.toBeNull();
    fireEvent.keyDown(editor.view.dom, { key: 'Tab', isComposing: true });
    // 输入法把组好的字写进正文（浏览器里是 ProseMirror 读 DOM 后发的这一个事务）。
    act(() => { editor.view.dispatch(editor.state.tr.insertText('然后')); });
    await settle(50);
    expect(transactions).toEqual([true]);
    fireEvent.compositionEnd(editor.view.dom);
    await waitFor(() => expect(body?.hasAttribute('data-composing')).toBe(false));
    expect(ghost()?.textContent).toBe('把事实记清楚。');
    expect(editor.getText()).toBe('正在记录这段经历然后');
    expect(stream).toHaveBeenCalledTimes(1);
    editor.off('transaction', record);
    turnOff();
  }, TEST_TIMEOUT_MS);

  it('组完提交的字和灰字对不上：撤下灰字，停笔后再要', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '正在记录这段经历') });
    const editor = await noteEditor();
    const stream = vi.spyOn(app.api.notes, 'assistStream').mockImplementation(async (_id, _input, onText) => {
      onText('然后把事实记清楚。');
      return { markdown: '然后把事实记清楚。', label: '续写' };
    });
    act(() => { editor.commands.focus('end'); });
    await waitFor(() => expect(ghost()).not.toBeNull(), { timeout: PREDICT_WAIT_MS });
    fireEvent.compositionStart(editor.view.dom);
    act(() => { editor.view.dispatch(editor.state.tr.insertText('但是')); });
    fireEvent.compositionEnd(editor.view.dom);
    await waitFor(() => expect(ghost()).toBeNull());
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2), { timeout: PREDICT_WAIT_MS });
    turnOff();
  }, TEST_TIMEOUT_MS);
});

// 预测闭环（11-13 Aaron 定）：摆出来的续写他收下就报 kept；摆了一会儿被打字盖掉报 rejected；一闪而过的不报。
describe('续写的结果报回去', () => {
  it('Tab 收下报 kept；摆够 1.5 秒后打别的字盖掉报 rejected', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '开头') });
    const editor = await noteEditor();
    let seq = 0;
    vi.spyOn(app.api.notes, 'assistStream').mockImplementation(async () => {
      seq += 1;
      return { markdown: '，续写的一句。', label: '续写', loopId: `loop-${seq}` };
    });
    const outcome = vi.spyOn(app.api.notes, 'assistOutcome').mockResolvedValue(undefined);
    act(() => { editor.commands.focus('end'); editor.commands.insertContent(PARAGRAPH); });
    await waitFor(() => expect(ghost()).not.toBeNull(), { timeout: PREDICT_WAIT_MS });
    fireEvent.keyDown(editor.view.dom, { key: 'Tab' });
    expect(outcome).toHaveBeenCalledWith('n1', { area: 'note_predict', loopId: 'loop-1', outcome: 'kept' });
    await waitFor(() => expect(ghost()).not.toBeNull(), { timeout: PREDICT_WAIT_MS });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1600)); });
    act(() => { editor.commands.insertContent('完全不一样的字'); });
    await waitFor(() => expect(outcome).toHaveBeenCalledWith('n1',
      { area: 'note_predict', loopId: 'loop-2', outcome: 'rejected' }));
    expect(outcome).toHaveBeenCalledTimes(2);
    turnOff();
  }, TEST_TIMEOUT_MS);
});
