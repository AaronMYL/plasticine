import { describe, expect, it, vi } from 'vitest';
import { ApiError, unauthorizedError, uncertainError } from '../../src/api/errors.ts';
import { hasUnsavedWork } from '../../src/shell/unsaved-guard.ts';
import { ConversationUi } from '../../src/state/conversation-ui.ts';
import { NoteDrafts } from '../../src/state/note-drafts.ts';
import { CREATE_NOTE_OP, deleteNoteOp, NOTE_OPS_STORAGE_KEY, NoteOps } from '../../src/state/note-ops.ts';
import { Outbox, OUTBOX_STORAGE_KEY, type KeyValueStorage } from '../../src/state/outbox.ts';
import { clampChatFrame } from '../../src/state/shell-prefs.ts';
import { Store } from '../../src/state/store.ts';
import { ViewScroll } from '../../src/state/view-scroll.ts';

describe('state/', () => {
  it('Store skips notify on unchanged value, notifies on change, and stops after unsubscribe', () => {
    const store = new Store(1);
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.set(1);
    expect(listener).not.toHaveBeenCalled();
    store.set((value) => value + 1);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.set(5);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('dedupes quote chips by ID and clears composer on send', () => {
    const ui = new ConversationUi();
    const quote = { id: 'q', kind: 'note' as const, sourceId: 'n', label: '《a》', text: 'x' };
    ui.addQuote(quote);
    ui.addQuote(quote);
    ui.setDraft('一句');
    expect(ui.store.get().quotes).toHaveLength(1);
    ui.clearComposer();
    expect(ui.store.get()).toMatchObject({ draft: '', quotes: [] });
  });

  it('stores, retrieves, and clears note drafts', () => {
    const drafts = new NoteDrafts();
    drafts.put({ noteId: 'n', baseVersion: 2, markdown: '草稿' });
    expect(drafts.get('n')?.markdown).toBe('草稿');
    expect(drafts.hasAny()).toBe(true);
    drafts.clear('n');
    expect(drafts.hasAny()).toBe(false);
  });

  it('stores and retrieves view scroll positions by key, defaulting to 0', () => {
    const scroll = new ViewScroll();
    scroll.save('view:today', 240);
    expect(scroll.restore('view:today')).toBe(240);
    expect(scroll.restore('view:notes')).toBe(0);
  });

  it('clamps floating chat size to 340x420..720w and keeps rect inside viewport', () => {
    const viewport = { width: 1440, height: 900 };
    expect(clampChatFrame({ width: 100, height: 100, right: 24, bottom: 24, full: false }, viewport))
      .toEqual({ width: 340, height: 420, right: 24, bottom: 24, full: false });
    expect(clampChatFrame({ width: 2000, height: 2000, right: -50, bottom: 5000, full: true }, viewport))
      .toEqual({ width: 720, height: 868, right: 16, bottom: 16, full: true });
    expect(clampChatFrame({ width: 420.4, height: 640, right: 3000, bottom: 24, full: false }, viewport))
      .toEqual({ width: 420, height: 640, right: 1004, bottom: 24, full: false });
  });

  it('prompts before unload when unsaved note draft or unsent chat draft exists', () => {
    const state = {
      noteDrafts: new NoteDrafts(),
      conversationUi: new ConversationUi(),
      outbox: new Outbox(),
      noteOps: new NoteOps(),
    };
    expect(hasUnsavedWork(state)).toBe(false);
    state.conversationUi.setDraft('没发的');
    expect(hasUnsavedWork(state)).toBe(true);
    state.conversationUi.setDraft('  ');
    state.noteDrafts.put({ noteId: 'n', baseVersion: 1, markdown: 'x' });
    expect(hasUnsavedWork(state)).toBe(true);
  });

  it('prompts before unload when chat draft has quote chips only', () => {
    const state = {
      noteDrafts: new NoteDrafts(),
      conversationUi: new ConversationUi(),
      outbox: new Outbox(),
      noteOps: new NoteOps(),
    };
    state.conversationUi.addQuote({ id: 'q', kind: 'note', sourceId: 'n', label: '《a》', text: 'x' });
    expect(hasUnsavedWork(state)).toBe(true);
  });

  it.each(['sending', 'uncertain', 'unsent', 'failed'] as const)('有「%s」的待发记录时也要问', (status) => {
    const state = {
      noteDrafts: new NoteDrafts(),
      conversationUi: new ConversationUi(),
      outbox: new Outbox(),
      noteOps: new NoteOps(),
    };
    state.outbox.add({ requestId: 'req_1', text: '一句', quotes: [], status, error: null });
    expect(hasUnsavedWork(state)).toBe(true);
  });
});

describe('state: restore to composer', () => {
  const old = { id: 'q_old', kind: 'note' as const, sourceId: 'n1', label: '《旧》', text: '旧引用' };
  const fresh = { id: 'q_new', kind: 'note' as const, sourceId: 'n2', label: '《新》', text: '新引用' };

  it('restores old text and quote chips verbatim into empty composer', () => {
    const ui = new ConversationUi();
    ui.restoreToComposer('没送到的一句', [old]);
    expect(ui.store.get()).toMatchObject({ draft: '没送到的一句', quotes: [old] });
  });

  it('appends old text after blank line without overwriting new draft and dedupes quote chips', () => {
    const ui = new ConversationUi();
    ui.setDraft('新写的\n');
    ui.addQuote(fresh);
    ui.addQuote(old);
    ui.restoreToComposer('没送到的一句', [old]);
    expect(ui.store.get().draft).toBe('新写的\n\n没送到的一句');
    expect(ui.store.get().quotes.map((quote) => quote.id)).toEqual(['q_new', 'q_old']);
  });

  it('restoring quote-only message keeps new draft text and appends quote chips', () => {
    const ui = new ConversationUi();
    ui.setDraft('新写的');
    ui.restoreToComposer('', [old]);
    expect(ui.store.get()).toMatchObject({ draft: '新写的', quotes: [old] });
  });
});

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('state: pending outbox records', () => {
  const quote = { id: 'q', kind: 'message' as const, sourceId: 'm1', label: '它 10:00 的回复', text: '一段' };

  it('persists in sessionStorage across reload and marks in-flight sends uncertain', () => {
    const storage = memoryStorage();
    const outbox = new Outbox(storage);
    outbox.add({ requestId: 'req_a', text: '待核实的', quotes: [quote], status: 'uncertain', error: '断网了' });
    outbox.add({ requestId: 'req_b', text: '发送中的', quotes: [], status: 'sending', error: null });
    const reloaded = new Outbox(storage);
    expect(reloaded.find('req_a')).toEqual({
      requestId: 'req_a',
      text: '待核实的',
      quotes: [quote],
      status: 'uncertain',
      error: '断网了',
    });
    expect(reloaded.find('req_b')?.status).toBe('uncertain');
    expect(reloaded.find('req_b')?.error).toContain('结果待核实');
  });

  it('clears sessionStorage once all pending records are dismissed', () => {
    const storage = memoryStorage();
    const outbox = new Outbox(storage);
    outbox.add({ requestId: 'req_a', text: '一句', quotes: [], status: 'failed', error: null });
    expect(storage.data.has(OUTBOX_STORAGE_KEY)).toBe(true);
    outbox.confirm(['req_a']);
    expect(storage.data.has(OUTBOX_STORAGE_KEY)).toBe(false);
  });

  it('ignores corrupt sessionStorage, logs warning, and starts empty', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = memoryStorage({ [OUTBOX_STORAGE_KEY]: JSON.stringify({ version: 1, pending: [{ text: 1 }] }) });
    expect(new Outbox(broken).store.get()).toEqual([]);
    const notJson = memoryStorage({ [OUTBOX_STORAGE_KEY]: '{' });
    expect(new Outbox(notJson).store.get()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('keeps in-memory records and logs when sessionStorage quota write fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const full = memoryStorage();
    full.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const outbox = new Outbox(full);
    outbox.add({ requestId: 'req_a', text: '一句', quotes: [], status: 'uncertain', error: null });
    expect(outbox.hasAny()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

const rejected = new ApiError({ kind: 'failed', code: 'rejected', message: '服务端拒绝了。', next: '改了再试。', status: 400 });

describe('state: note operation request IDs', () => {
  it('reuses request_id while uncertain or in-flight; mints new ID after failure or completion', () => {
    const ops = new NoteOps();
    let sequence = 0;
    const next = (): string => {
      sequence += 1;
      return `req_${sequence}`;
    };
    expect(ops.begin(CREATE_NOTE_OP, next)).toBe('req_1');
    expect(ops.begin(CREATE_NOTE_OP, next)).toBe('req_1');
    ops.fail(CREATE_NOTE_OP, uncertainError('新建笔记'));
    expect(ops.get(CREATE_NOTE_OP)?.status).toBe('uncertain');
    expect(ops.begin(CREATE_NOTE_OP, next)).toBe('req_1');
    ops.fail(CREATE_NOTE_OP, rejected);
    expect(ops.begin(CREATE_NOTE_OP, next)).toBe('req_2');
    ops.succeed(CREATE_NOTE_OP);
    expect(ops.get(CREATE_NOTE_OP)).toBeUndefined();
    expect(ops.begin(CREATE_NOTE_OP, next)).toBe('req_3');
  });

  it('tracks delete operations separately per note', () => {
    const ops = new NoteOps();
    ops.begin(deleteNoteOp('n1'), () => 'req_n1');
    ops.begin(deleteNoteOp('n2'), () => 'req_n2');
    expect(ops.get(deleteNoteOp('n1'))?.requestId).toBe('req_n1');
    expect(ops.get(deleteNoteOp('n2'))?.requestId).toBe('req_n2');
  });

  it('persists uncertain note create in sessionStorage so retry reuses ID without duplicating', () => {
    const storage = memoryStorage();
    const ops = new NoteOps(storage);
    expect(ops.begin(CREATE_NOTE_OP, () => 'req_first')).toBe('req_first');
    ops.fail(CREATE_NOTE_OP, uncertainError('新建笔记'));
    const reloaded = new NoteOps(storage);
    expect(reloaded.get(CREATE_NOTE_OP)?.status).toBe('uncertain');
    expect(reloaded.begin(CREATE_NOTE_OP, () => 'req_second')).toBe('req_first');
    reloaded.succeed(CREATE_NOTE_OP);
    expect(storage.data.has(NOTE_OPS_STORAGE_KEY)).toBe(false);
  });

  it('marks pre-reload in-flight operation uncertain keeping original ID', () => {
    const storage = memoryStorage();
    new NoteOps(storage).begin(deleteNoteOp('n1'), () => 'req_del');
    const reloaded = new NoteOps(storage);
    expect(reloaded.get(deleteNoteOp('n1'))).toMatchObject({ requestId: 'req_del', status: 'uncertain' });
  });

  it('401 during recheck keeps uncertain state and ID; 401 on fresh attempt marks failed', () => {
    const ops = new NoteOps();
    ops.begin(CREATE_NOTE_OP, () => 'req_a');
    ops.fail(CREATE_NOTE_OP, uncertainError('新建笔记'));
    ops.begin(CREATE_NOTE_OP, () => 'req_b');
    ops.fail(CREATE_NOTE_OP, unauthorizedError());
    expect(ops.get(CREATE_NOTE_OP)?.status).toBe('uncertain');
    expect(ops.begin(CREATE_NOTE_OP, () => 'req_c')).toBe('req_a');
    const fresh = new NoteOps();
    fresh.begin(deleteNoteOp('n2'), () => 'req_d');
    fresh.fail(deleteNoteOp('n2'), unauthorizedError());
    expect(fresh.get(deleteNoteOp('n2'))?.status).toBe('failed');
  });

  it('in-flight or uncertain note operations trigger unload prompt; explicit failures do not', () => {
    const state = {
      noteDrafts: new NoteDrafts(),
      conversationUi: new ConversationUi(),
      outbox: new Outbox(),
      noteOps: new NoteOps(),
    };
    state.noteOps.begin(CREATE_NOTE_OP, () => 'req_x');
    expect(hasUnsavedWork(state)).toBe(true);
    state.noteOps.fail(CREATE_NOTE_OP, rejected);
    expect(hasUnsavedWork(state)).toBe(false);
  });
});
