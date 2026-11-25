import type { Editor } from '@tiptap/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp, seedNote } from '../../helpers.tsx';

async function editor(): Promise<Editor> {
  return waitFor(() => {
    const found = document.querySelector<HTMLElement & { editor?: Editor }>('.ProseMirror');
    if (found?.editor === undefined) {
      throw new Error('等待笔记编辑器');
    }
    return found.editor;
  });
}

describe('Note versions', () => {
  it('opens note with body and version history directly without showing or calling unlock', async () => {
    const app = await renderApp({
      hash: '#/notes/n1',
      setup: (fake) => {
        seedNote(fake, 'n1', '# 周末安排');
        vi.spyOn(fake.api.signed, 'send');
      },
    });
    expect((await editor()).getText()).toContain('周末安排');
    expect(screen.queryByRole('button', { name: /解锁/ })).toBeNull();
    expect(await app.api.notes.list({})).toEqual([expect.objectContaining({ title: '周末安排' })]);
    fireEvent.click(screen.getByLabelText('更多笔记操作'));
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }));
    fireEvent.click(await screen.findByRole('button', { name: /查看第 1 版/ }));
    expect((await screen.findByLabelText('历史正文')).textContent).toContain('周末安排');
    expect(app.api.signed.send).not.toHaveBeenCalled();
  });
  it('browsing history keeps draft; restoring saves draft first and preserves both versions', async () => {
    const app = await renderApp({
      hash: '#/notes/n1',
      setup: (fake) => {
        seedNote(fake, 'n1', '# 初稿');
        fake.control.notes.externalEdit('n1', '# 当前稿');
      },
    });
    const current = await editor();
    act(() => current.commands.insertContent('未保存的字'));
    fireEvent.click(screen.getByLabelText('更多笔记操作'));
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }));
    const sheet = await screen.findByRole('dialog', { name: '笔记版本' });
    fireEvent.click(await within(sheet).findByRole('button', { name: /查看第 1 版/ }));
    await within(sheet).findByLabelText('历史正文');
    expect(current.getText()).toContain('未保存的字');
    expect((await app.api.notes.get('n1')).markdown).toBe('# 当前稿');
    fireEvent.click(within(sheet).getByRole('button', { name: '以此版恢复' }));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: /^恢复到第/ }))
      .getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(current.getText().trim()).toBe('初稿'));
    const history = await app.api.noteVersions.versions('n1');
    expect(history.versions.map((row) => row.version)).toEqual([4, 3, 2, 1]);
    expect((await app.api.noteVersions.version('n1', 3)).markdown).toContain('未保存的字');
  });

  it('lost restore receipt verifies via action-ops request without duplicating restore', async () => {
    const app = await renderApp({
      hash: '#/notes/n1',
      setup: (fake) => {
        seedNote(fake, 'n1', '初稿');
        fake.control.notes.externalEdit('n1', '当前稿');
        fake.control.faults.next('save', { kind: 'uncertain', landed: true });
      },
    });
    await editor();
    const save = vi.spyOn(app.api.notes, 'save');
    fireEvent.click(screen.getByLabelText('更多笔记操作'));
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }));
    const sheet = await screen.findByRole('dialog', { name: '笔记版本' });
    fireEvent.click(await within(sheet).findByRole('button', { name: /查看第 1 版/ }));
    await within(sheet).findByLabelText('历史正文');
    fireEvent.click(within(sheet).getByRole('button', { name: '以此版恢复' }));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: /^恢复到第/ }))
      .getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(app.state.actionOps.hasPending()).toBe(true));
    fireEvent.click(await screen.findByRole('button', { name: '再核实' }));
    await waitFor(() => expect(app.state.actionOps.hasPending()).toBe(false));
    expect(save.mock.calls[0]?.[1].requestId).toBe(save.mock.calls[1]?.[1].requestId);
    expect((await app.api.notes.get('n1')).version).toBe(3);
  });
});
