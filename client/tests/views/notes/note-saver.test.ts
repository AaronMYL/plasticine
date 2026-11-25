import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteConflictError, uncertainError } from '../../../src/api/errors.ts';
import type { NoteView, SaveNoteRequest } from '../../../src/api/types.ts';
import { NoteDrafts } from '../../../src/state/note-drafts.ts';
import { ActionOps } from '../../../src/state/action-ops.ts';
import { AUTOSAVE_DELAY_MS, NoteSaver } from '../../../src/views/notes/note-saver.ts';
import { NOW } from '../../helpers.tsx';

function note(markdown: string, version = 1): NoteView {
  return {
    id: 'n1',
    title: '计划',
    folder: 'notes',
    pinned: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    preview: '',
    bytes: new TextEncoder().encode(markdown).length,
    version,
    author: 'user',
    readOnly: false,
    deletedAt: null,
    migrated: false,
    markdown,
  };
}

let ids = 0;
const newRequestId = (): string => {
  ids += 1;
  return `req_${ids}`;
};

function server(results: Array<(input: SaveNoteRequest) => Promise<NoteView>> = []) {
  const calls: SaveNoteRequest[] = [];
  let version = 1;
  const save = vi.fn(async (_id: string, input: SaveNoteRequest): Promise<NoteView> => {
    calls.push(input);
    const scripted = results.shift();
    if (scripted !== undefined) {
      return scripted(input);
    }
    version = Math.max(version, input.version) + 1;
    return note(input.markdown ?? '', version);
  });
  return { save, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Note autosave', () => {
  it('reopening landed note with unknown receipt stays pending verification and replays request', async () => {
    const actionOps = new ActionOps();
    const original = { requestId: 'req-reload-history', version: 1, markdown: '第二版' };
    actionOps.begin('note:n1:save', '保存笔记', '笔记',
      () => ({ kind: 'note_save', noteId: 'n1', body: original }), () => original.requestId);
    actionOps.fail('note:n1:save', uncertainError('保存'));
    const { save, calls } = server([async () => note('第二版', 2)]);
    const saver = new NoteSaver({ note: note('第二版', 2), drafts: new NoteDrafts(), actionOps, save, newRequestId });
    expect(saver.state.get().status).toBe('uncertain');
    await saver.flush();
    expect(calls).toEqual([original]);
    expect(actionOps.hasPending()).toBe(false);
    saver.dispose();
  });
  it('saves 1.2s after typing stops with draft base version and clears draft on success', async () => {
    const drafts = new NoteDrafts();
    const { save, calls } = server();
    const saver = new NoteSaver({ note: note('第一段'), drafts, save, newRequestId });
    saver.edit('第一段，第二段');
    expect(saver.state.get().status).toBe('dirty');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(calls[0]).toMatchObject({ markdown: '第一段，第二段', version: 1 });
    expect(saver.state.get().status).toBe('saved');
    expect(drafts.get('n1')).toBeUndefined();
  });

  it('skips save and returns to saved state when reverted to match server', async () => {
    const drafts = new NoteDrafts();
    const { save } = server();
    const saver = new NoteSaver({ note: note('原文'), drafts, save, newRequestId });
    saver.edit('改了');
    saver.edit('原文');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
    expect(saver.state.get().status).toBe('saved');
  });

  it('defers save during IME composition and schedules once composition ends', async () => {
    const drafts = new NoteDrafts();
    const { save } = server();
    const saver = new NoteSaver({ note: note(''), drafts, save, newRequestId });
    saver.setComposing(true);
    saver.edit('ni');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(save).not.toHaveBeenCalled();
    saver.edit('你');
    saver.setComposing(false);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1].markdown).toBe('你');
  });

  it('409 conflict enters conflict state without overwriting; Use new version discards draft', async () => {
    const drafts = new NoteDrafts();
    const theirs = note('别处的版本', 5);
    const { save } = server([async () => Promise.reject(new NoteConflictError(theirs))]);
    const saver = new NoteSaver({ note: note('原文'), drafts, save, newRequestId });
    saver.edit('我的版本');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saver.state.get()).toMatchObject({ status: 'conflict', conflict: theirs });
    expect(drafts.get('n1')?.markdown).toBe('我的版本');
    expect(saver.takeTheirs()).toBe('别处的版本');
    expect(drafts.get('n1')).toBeUndefined();
    expect(saver.state.get().status).toBe('saved');
  });

  it('Keep mine on conflict saves again on top of new server version', async () => {
    const drafts = new NoteDrafts();
    const theirs = note('别处的版本', 5);
    const { save, calls } = server([async () => Promise.reject(new NoteConflictError(theirs))]);
    const saver = new NoteSaver({ note: note('原文'), drafts, save, newRequestId });
    saver.edit('我的版本');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    await saver.keepMine();
    expect(calls[1]).toMatchObject({ markdown: '我的版本', version: 5 });
    expect(saver.state.get().status).toBe('saved');
  });

  it('409 whose version matches own lost-receipt save resolves as saved without conflict', async () => {
    const drafts = new NoteDrafts();
    const { save } = server([async (input) => Promise.reject(new NoteConflictError(note(input.markdown ?? '', 3)))]);
    const saver = new NoteSaver({ note: note('原文'), drafts, save, newRequestId });
    saver.edit('已经落地的');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saver.state.get().status).toBe('saved');
    expect(drafts.get('n1')).toBeUndefined();
  });

  it('uncertain receipt enters pending verification and retries with same request_id', async () => {
    const drafts = new NoteDrafts();
    const { save, calls } = server([async () => Promise.reject(uncertainError('保存笔记'))]);
    const saver = new NoteSaver({ note: note('原文'), drafts, save, newRequestId });
    saver.edit('要存的');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saver.state.get().status).toBe('uncertain');
    expect(drafts.get('n1')?.markdown).toBe('要存的');
    await saver.flush();
    expect(calls[1]?.requestId).toBe(calls[0]?.requestId);
    expect(saver.state.get().status).toBe('saved');
  });

  it('explicit failure sets save failed, keeps draft, and reschedules on next edit', async () => {
    const drafts = new NoteDrafts();
    const { save } = server([async () => Promise.reject(new Error('磁盘满了'))]);
    const saver = new NoteSaver({ note: note('原文'), drafts, save, newRequestId });
    saver.edit('一');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saver.state.get()).toMatchObject({ status: 'failed', error: '出错了：磁盘满了' });
    saver.edit('一二');
    expect(saver.state.get().status).toBe('dirty');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saver.state.get().status).toBe('saved');
  });

  it('typing during save persists previous version first then saves new draft on top', async () => {
    const drafts = new NoteDrafts();
    let release: (() => void) | undefined;
    const { save, calls } = server([
      async (input) =>
        new Promise<NoteView>((resolve) => {
          release = () => resolve(note(input.markdown ?? '', 2));
        }),
    ]);
    const saver = new NoteSaver({ note: note('原文'), drafts, save, newRequestId });
    saver.edit('第一版');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    saver.edit('第一版又加了字');
    release?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(drafts.get('n1')?.baseVersion).toBe(2);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(calls[1]).toMatchObject({ markdown: '第一版又加了字', version: 2 });
  });

  it('undoing to original while save is in flight keeps draft and saves original once landed', async () => {
    const drafts = new NoteDrafts();
    let release: (() => void) | undefined;
    const { save, calls } = server([
      async (input) =>
        new Promise<NoteView>((resolve) => {
          release = () => resolve(note(input.markdown ?? '', 2));
        }),
    ]);
    const saver = new NoteSaver({ note: note('原文'), drafts, save, newRequestId });
    saver.edit('改过的');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saver.state.get().status).toBe('saving');
    saver.edit('原文');
    expect(saver.state.get().status).not.toBe('saved');
    expect(drafts.get('n1')?.markdown).toBe('原文');
    release?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(drafts.get('n1')).toMatchObject({ markdown: '原文', baseVersion: 2 });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(calls[1]).toMatchObject({ markdown: '原文', version: 2 });
    expect(saver.state.get().status).toBe('saved');
    expect(drafts.get('n1')).toBeUndefined();
  });

  it('flushes save on unmount and retains unsaved draft in state/ for next editor', async () => {
    const drafts = new NoteDrafts();
    const { save } = server([async () => Promise.reject(new Error('断网'))]);
    const first = new NoteSaver({ note: note('原文'), drafts, save, newRequestId });
    first.edit('切走前写的');
    first.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(drafts.get('n1')?.markdown).toBe('切走前写的');

    const second = new NoteSaver({ note: note('原文'), drafts, save, newRequestId });
    expect(second.initialMarkdown()).toBe('切走前写的');
    expect(second.state.get().status).toBe('dirty');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(second.state.get().status).toBe('saved');
  });

  it('adopts remote new version when clean and defers when unsaved edits exist', () => {
    const drafts = new NoteDrafts();
    const { save } = server();
    const saver = new NoteSaver({ note: note('原文'), drafts, save, newRequestId });
    expect(saver.applyRemote(note('别处 v2', 2))).toBe(true);
    expect(saver.applyRemote(note('旧的', 1))).toBe(false);
    saver.edit('我在写');
    expect(saver.applyRemote(note('别处 v3', 3))).toBe(false);
  });
});
