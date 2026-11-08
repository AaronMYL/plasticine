import { describe, expect, it, vi } from 'vitest';
import { ApiError, unauthorizedError, uncertainError } from '../../src/api/errors.ts';
import { hasUnsavedWork } from '../../src/shell/unsaved-guard.ts';
import { ConversationUi } from '../../src/state/conversation-ui.ts';
import { NoteDrafts } from '../../src/state/note-drafts.ts';
import { CREATE_NOTE_OP, deleteNoteOp, NOTE_OPS_STORAGE_KEY, NoteOps } from '../../src/state/note-ops.ts';
import { Outbox, OUTBOX_STORAGE_KEY, type KeyValueStorage } from '../../src/state/outbox.ts';
import { clampChatFrame, ShellPrefs } from '../../src/state/shell-prefs.ts';
import { Store } from '../../src/state/store.ts';
import { ViewScroll } from '../../src/state/view-scroll.ts';

describe('state/', () => {
  it('Store：值没变不通知，变了通知；退订后不再收到', () => {
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

  it('引用片按 id 只放一次；发出去后输入框清空', () => {
    const ui = new ConversationUi();
    const quote = { id: 'q', kind: 'note' as const, sourceId: 'n', label: '《a》', text: 'x' };
    ui.addQuote(quote);
    ui.addQuote(quote);
    ui.setDraft('一句');
    expect(ui.store.get().quotes).toHaveLength(1);
    ui.clearComposer();
    expect(ui.store.get()).toMatchObject({ draft: '', quotes: [] });
  });

  it('笔记草稿：放进去、取出来、清掉', () => {
    const drafts = new NoteDrafts();
    drafts.put({ noteId: 'n', baseVersion: 2, markdown: '草稿' });
    expect(drafts.get('n')?.markdown).toBe('草稿');
    expect(drafts.hasAny()).toBe(true);
    drafts.clear('n');
    expect(drafts.hasAny()).toBe(false);
  });

  it('视图滚动位置按 key 存取，没存过是 0', () => {
    const scroll = new ViewScroll();
    scroll.save('view:today', 240);
    expect(scroll.restore('view:today')).toBe(240);
    expect(scroll.restore('view:notes')).toBe(0);
  });

  it('对话框的大小夹在 340×420 到 720 宽之间，整个框留在窗口里', () => {
    const viewport = { width: 1440, height: 900 };
    expect(clampChatFrame({ width: 100, height: 100, right: 24, bottom: 24 }, viewport))
      .toEqual({ width: 340, height: 420, right: 24, bottom: 24 });
    expect(clampChatFrame({ width: 2000, height: 2000, right: -50, bottom: 5000 }, viewport))
      .toEqual({ width: 720, height: 868, right: 16, bottom: 16 });
    expect(clampChatFrame({ width: 420.4, height: 640, right: 3000, bottom: 24 }, viewport))
      .toEqual({ width: 420, height: 640, right: 1004, bottom: 24 });
  });

  it('有没存的笔记草稿或没发的对话草稿时，离开页面前要问', () => {
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

  it('只有引用片、没有字的草稿也要问', () => {
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

describe('state/ · 放回输入框', () => {
  const old = { id: 'q_old', kind: 'note' as const, sourceId: 'n1', label: '《旧》', text: '旧引用' };
  const fresh = { id: 'q_new', kind: 'note' as const, sourceId: 'n2', label: '《新》', text: '新引用' };

  it('输入框空着：旧内容和引用片原样放回', () => {
    const ui = new ConversationUi();
    ui.restoreToComposer('没送到的一句', [old]);
    expect(ui.store.get()).toMatchObject({ draft: '没送到的一句', quotes: [old] });
  });

  it('输入框里已有新草稿：不覆盖，旧内容接在后面、中间空一行；引用片追加、同一条不重复', () => {
    const ui = new ConversationUi();
    ui.setDraft('新写的\n');
    ui.addQuote(fresh);
    ui.addQuote(old);
    ui.restoreToComposer('没送到的一句', [old]);
    expect(ui.store.get().draft).toBe('新写的\n\n没送到的一句');
    expect(ui.store.get().quotes.map((quote) => quote.id)).toEqual(['q_new', 'q_old']);
  });

  it('放回的只有引用片：新草稿的字不动，引用片加上', () => {
    const ui = new ConversationUi();
    ui.setDraft('新写的');
    ui.restoreToComposer('', [old]);
    expect(ui.store.get()).toMatchObject({ draft: '新写的', quotes: [old] });
  });
});

/** 内存里的 sessionStorage。 */
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

describe('state/ · 待发记录', () => {
  const quote = { id: 'q', kind: 'message' as const, sourceId: 'm1', label: '它 10:00 的回复', text: '一段' };

  it('存进 sessionStorage，刷新后还在；刷新前还在发送中的算「结果待核实」', () => {
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

  it('都收掉之后 sessionStorage 里也清掉', () => {
    const storage = memoryStorage();
    const outbox = new Outbox(storage);
    outbox.add({ requestId: 'req_a', text: '一句', quotes: [], status: 'failed', error: null });
    expect(storage.data.has(OUTBOX_STORAGE_KEY)).toBe(true);
    outbox.confirm(['req_a']);
    expect(storage.data.has(OUTBOX_STORAGE_KEY)).toBe(false);
  });

  it('sessionStorage 里的东西格式不对：不拿来用，记一条日志，从空的开始', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = memoryStorage({ [OUTBOX_STORAGE_KEY]: JSON.stringify({ version: 1, pending: [{ text: 1 }] }) });
    expect(new Outbox(broken).store.get()).toEqual([]);
    const notJson = memoryStorage({ [OUTBOX_STORAGE_KEY]: '{' });
    expect(new Outbox(notJson).store.get()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('sessionStorage 写不进去（满了）：内存里的记录照常在，记一条日志', () => {
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

describe('state/ · 笔记操作的标识', () => {
  it('回执不确定或还在路上：再开始沿用同一个 request_id；明确失败或已了结：换新的', () => {
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

  it('删除按笔记分开记', () => {
    const ops = new NoteOps();
    ops.begin(deleteNoteOp('n1'), () => 'req_n1');
    ops.begin(deleteNoteOp('n2'), () => 'req_n2');
    expect(ops.get(deleteNoteOp('n1'))?.requestId).toBe('req_n1');
    expect(ops.get(deleteNoteOp('n2'))?.requestId).toBe('req_n2');
  });

  it('待核实的新建存进 sessionStorage：刷新后还在，再点用的是同一个 request_id，不会建第二篇', () => {
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

  it('刷新前还在路上的操作：刷新后算「结果待核实」，沿用原标识', () => {
    const storage = memoryStorage();
    new NoteOps(storage).begin(deleteNoteOp('n1'), () => 'req_del');
    const reloaded = new NoteOps(storage);
    expect(reloaded.get(deleteNoteOp('n1'))).toMatchObject({ requestId: 'req_del', status: 'uncertain' });
  });

  it('待核实过的操作，核实时遇到会话失效（401）：仍是待核实、沿用原标识；没待核实过的 401 才算失败', () => {
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

  it('还在路上或待核实的笔记操作也算没完成：离开页面前要问；明确失败的不算', () => {
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
