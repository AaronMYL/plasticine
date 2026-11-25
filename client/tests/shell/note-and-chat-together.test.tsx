import type { Editor } from '@tiptap/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HOME_HEADING, renderApp, seedNote, settle } from '../helpers.tsx';

async function noteEditor(): Promise<Editor> {
  return waitFor(() => {
    const element = document.querySelector<HTMLElement & { editor?: Editor }>('.ProseMirror');
    if (element?.editor === undefined) {
      throw new Error('编辑器还没出来');
    }
    return element.editor;
  });
}

function typeInNote(editor: Editor, text: string): void {
  act(() => {
    editor.commands.focus('end');
    editor.commands.insertContent(text);
  });
}

describe('M1 exit criteria', () => {
  it('switching to today and back preserves unsaved note text and unsent chat draft', async () => {
    const app = await renderApp({
      hash: '#/notes/n1',
      setup: (fake) => {
        seedNote(fake, 'n1', '# 计划\n\n第一段。');
        fake.control.faults.next('save', { kind: 'failed', message: '磁盘满了。' });
      },
    });
    typeInNote(await noteEditor(), '还没存上的一段。');
    fireEvent.change(screen.getByRole('textbox', { name: '问一句' }), { target: { value: '想问又没问的' } });

    fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: '首页' }));
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: HOME_HEADING })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '笔记' }));
    await settle();

    expect(app.state.noteDrafts.get('n1')?.markdown).toContain('还没存上的一段。');
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toContain('还没存上的一段。'));
    expect(screen.getByRole('textbox', { name: '问一句' })).toHaveProperty('value', '想问又没问的');
  });

  it('quote to chat confirms saved version first, adds full text chip without switching page', async () => {
    const markdown = `# 读书摘记\n\n${'一段话。'.repeat(200)}全文最后一句`;
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', markdown) });
    await noteEditor();
    fireEvent.click(screen.getByRole('button', { name: '引用到对话' }));
    expect((await screen.findByLabelText('引用片')).textContent).toContain('《读书摘记》');
    expect(app.state.conversationUi.store.get().quotes[0]?.text).toBe(markdown);
    expect(app.state.conversationUi.store.get().quotes[0]?.noteReference)
      .toEqual({ noteId: 'n1', version: 1, scope: 'full' });
    expect(screen.getByLabelText('引用片').textContent).toContain('全文');
    expect(window.location.hash).toBe('#/notes/n1');
  });
});
