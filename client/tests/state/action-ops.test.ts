import { describe, expect, it, vi } from 'vitest';
import { ApiError, unauthorizedError, uncertainError } from '../../src/api/errors.ts';
import { hasUnsavedWork } from '../../src/shell/unsaved-guard.ts';
import {
  ACTION_OPS_STORAGE_KEY,
  ActionOps,
  askOpKey,
  requestIdOf,
  type ActionRequest,
} from '../../src/state/action-ops.ts';
import { INLINE_DRAFTS_STORAGE_KEY, InlineDrafts } from '../../src/state/inline-drafts.ts';
import { ConversationUi } from '../../src/state/conversation-ui.ts';
import { NoteDrafts } from '../../src/state/note-drafts.ts';
import { NoteOps } from '../../src/state/note-ops.ts';
import { Outbox } from '../../src/state/outbox.ts';
import { memoryStorage } from '../helpers.tsx';

const KEY = askOpKey('ask_1', 'defer');

it.each(['result_expired', 'result_scope_mismatch'])('查询回执受限 %s 不能被当成原动作失败或未送达', (code) => {
  const ops = new ActionOps();
  ops.begin(KEY, '暂停', '任务', pause, newId);
  ops.fail(KEY, uncertainError('回执丢了'));
  ops.retry(KEY);
  ops.fail(KEY, new ApiError({ kind: 'failed', code, status: 410, message: '不能读取回执' }));
  expect(ops.get(KEY)).toMatchObject({ status: 'uncertain', unresolved: true });
});

function pause(id: string): ActionRequest {
  return { kind: 'ask_defer', askId: 'ask_1', body: { requestId: id } };
}

let sequence = 0;
function newId(): string {
  sequence += 1;
  return `req_${String(sequence).padStart(8, '0')}`;
}

function refusal(): ApiError {
  return new ApiError({
    kind: 'failed',
    code: 'command_not_allowed',
    message: '这张卡已经答过了，不能先不。',
    status: 409,
  });
}

function shuttingDown(): ApiError {
  return new ApiError({ kind: 'failed', code: 'shutting_down', message: '服务正在重启，这次没有收下。', status: 503 });
}

function idOf(request: ActionRequest | undefined): string | undefined {
  return request?.kind === 'ask_defer' ? request.body.requestId : undefined;
}

describe('卡操作的标识', () => {
  it('回执不确定之后再点同一个按钮：沿用同一个 requestId', () => {
    const ops = new ActionOps();
    const first = ops.begin(KEY, '暂停', '整理账单', pause, newId);
    ops.fail(KEY, uncertainError('任务命令'));
    expect(ops.get(KEY)?.status).toBe('uncertain');
    const second = ops.begin(KEY, '暂停', '整理账单', pause, newId);
    expect(idOf(second)).toBe(idOf(first));
  });

  it('没了结时再开始一次：原样发上一次存下的请求体，不按这次的输入重写（第二个问题不会悄悄丢掉）', () => {
    const ops = new ActionOps();
    const key = askOpKey('ask_1', 'ask');
    const about = (text: string) => (id: string): ActionRequest => ({
      kind: 'ask_about',
      askId: 'ask_1',
      body: { requestId: id, text },
    });
    const first = ops.begin(key, '问一句', '先怎么处理？', about('为什么是这 3 笔？'), newId);
    ops.fail(key, uncertainError('问一句'));
    const second = ops.begin(key, '问一句', '先怎么处理？', about('换个问题'), newId);
    expect(second).toEqual(first);
    expect(ops.get(key)?.request).toEqual(first);
    // 有了结果（被拒）之后，新输入才用新标识、新内容。
    ops.fail(key, refusal());
    const third = ops.begin(key, '问一句', '先怎么处理？', about('换个问题'), newId);
    expect(third).toMatchObject({ body: { text: '换个问题' } });
    expect(requestIdOf(third)).not.toBe(requestIdOf(first));
  });

  it('「再核实」原样再发存下的请求，标识不变', () => {
    const ops = new ActionOps();
    const first = ops.begin(KEY, '暂停', '整理账单', pause, newId);
    ops.fail(KEY, uncertainError('任务命令'));
    expect(ops.retry(KEY)).toEqual(first);
    expect(ops.get(KEY)?.status).toBe('running');
  });

  it('服务端明确拒了（409）：状态是被拒、文案是服务端那句；下一次点换新标识', () => {
    const ops = new ActionOps();
    const first = ops.begin(KEY, '暂停', '整理账单', pause, newId);
    ops.fail(KEY, refusal());
    expect(ops.get(KEY)).toMatchObject({ status: 'failed', error: expect.stringContaining('不能先不') });
    const second = ops.begin(KEY, '暂停', '整理账单', pause, newId);
    expect(idOf(second)).not.toBe(idOf(first));
  });

  it('401：服务端在看标识之前就挡下了——没待核实过的是「没送到」，沿用标识，重新配对后重发', () => {
    const ops = new ActionOps();
    const first = ops.begin(KEY, '暂停', '整理账单', pause, newId);
    ops.fail(KEY, unauthorizedError());
    expect(ops.get(KEY)?.status).toBe('unsent');
    expect(idOf(ops.retry(KEY))).toBe(idOf(first));
  });

  it('401：之前待核实过的仍是待核实（它可能已经生效），不让「不发了」', () => {
    const ops = new ActionOps();
    ops.begin(KEY, '暂停', '整理账单', pause, newId);
    ops.fail(KEY, uncertainError('任务命令'));
    ops.retry(KEY);
    ops.fail(KEY, unauthorizedError());
    expect(ops.get(KEY)).toMatchObject({ status: 'uncertain', unresolved: true });
    ops.dismiss(KEY);
    expect(ops.get(KEY)).toBeDefined();
  });

  it('503 shutting_down 明说没收下：「没送到」，同一标识重发', () => {
    const ops = new ActionOps();
    const first = ops.begin(KEY, '暂停', '整理账单', pause, newId);
    ops.fail(KEY, shuttingDown());
    expect(ops.get(KEY)?.status).toBe('unsent');
    expect(idOf(ops.begin(KEY, '暂停', '整理账单', pause, newId))).toBe(idOf(first));
  });

  it('另存进 sessionStorage：刷新后还在，刷新前还在路上的算待核实', () => {
    const storage = memoryStorage();
    const ops = new ActionOps(storage);
    const first = ops.begin(KEY, '暂停', '整理账单', pause, newId);
    expect(storage.data.has(ACTION_OPS_STORAGE_KEY)).toBe(true);
    const reloaded = new ActionOps(storage);
    expect(reloaded.get(KEY)).toMatchObject({ status: 'uncertain', unresolved: true });
    expect(idOf(reloaded.retry(KEY))).toBe(idOf(first));
  });

  it('sessionStorage 里的格式不对：不用它，从空的开始', () => {
    const storage = memoryStorage();
    storage.setItem(ACTION_OPS_STORAGE_KEY, JSON.stringify({ version: 1, ops: [{ key: 'x' }] }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(new ActionOps(storage).store.get()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('存着的旧记忆条目操作（2026-11-03 接口已删）丢掉，同一份里别的操作照常恢复', () => {
    const storage = memoryStorage();
    const ops = new ActionOps(storage);
    ops.begin(KEY, '暂停', '整理账单', pause, newId);
    const stored = JSON.parse(storage.getItem(ACTION_OPS_STORAGE_KEY) ?? '{}') as { ops: unknown[] };
    const kept = stored.ops[0] as Record<string, unknown>;
    const old = [
      { ...kept, key: 'memory:m1:edit', request: { kind: 'memory_edit', entryId: 'm1',
        body: { requestId: 'req_old_0001', version: 1, stale: true } } },
      { ...kept, key: 'cognition:create:quotes', request: { kind: 'cognition_write',
        body: { requestId: 'req_old_0002', kind: 'memory_create', column: 'quote', text: '旧的' } } },
    ];
    storage.setItem(ACTION_OPS_STORAGE_KEY, JSON.stringify({ ...stored, ops: [...old, ...stored.ops] }));
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const reloaded = new ActionOps(storage);
    expect(reloaded.store.get().map((op) => op.key)).toEqual([KEY]);
    expect(info).toHaveBeenCalled();
  });

  it('存着的站内信回复、全部标已读、核实回复（第 113 条站内信页去掉了）丢掉，别的照常恢复', () => {
    const storage = memoryStorage();
    const ops = new ActionOps(storage);
    ops.begin(KEY, '暂停', '整理账单', pause, newId);
    const stored = JSON.parse(storage.getItem(ACTION_OPS_STORAGE_KEY) ?? '{}') as { ops: unknown[] };
    const kept = stored.ops[0] as Record<string, unknown>;
    const old = [
      { ...kept, key: 'inbox:in_1:reply', request: { kind: 'inbox_reply', messageId: 'in_1',
        body: { requestId: 'req_old_0003', text: '好' } } },
      { ...kept, key: 'inbox:box:all:read-all', request: { kind: 'inbox_read_all',
        body: { requestId: 'req_old_0004', box: 'all' } } },
      { ...kept, key: 'inbox:reply:r1:settle', request: { kind: 'inbox_settle', replyId: 'r1',
        body: { requestId: 'req_old_0005', happened: true } } },
    ];
    storage.setItem(ACTION_OPS_STORAGE_KEY, JSON.stringify({ ...stored, ops: [...old, ...stored.ops] }));
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    expect(new ActionOps(storage).store.get().map((op) => op.key)).toEqual([KEY]);
    expect(info).toHaveBeenCalled();
  });

  it('还有没了结的命令：离开页面前要问一句；只剩被拒的不问', () => {
    const actionOps = new ActionOps();
    const state = {
      noteDrafts: new NoteDrafts(),
      conversationUi: new ConversationUi(),
      outbox: new Outbox(),
      noteOps: new NoteOps(),
      actionOps,
    };
    actionOps.begin(KEY, '暂停', '整理账单', pause, newId);
    expect(hasUnsavedWork(state)).toBe(true);
    actionOps.fail(KEY, refusal());
    expect(hasUnsavedWork(state)).toBe(false);
  });
});

describe('任务条、卡上就地写的一句', () => {
  it('按 id 存、另存进 sessionStorage：刷新后还在；写空就清掉', () => {
    const storage = memoryStorage();
    const drafts = new InlineDrafts(storage);
    drafts.set(askOpKey('ask_1', 'ask'), '为什么是这 3 笔？');
    drafts.set(askOpKey('ask_2', 'ask'), '另一张卡');
    expect(storage.data.has(INLINE_DRAFTS_STORAGE_KEY)).toBe(true);
    const reloaded = new InlineDrafts(storage);
    expect(reloaded.get(askOpKey('ask_1', 'ask'))).toBe('为什么是这 3 笔？');
    expect(reloaded.get(askOpKey('ask_2', 'ask'))).toBe('另一张卡');
    reloaded.set(askOpKey('ask_1', 'ask'), '');
    reloaded.clear(askOpKey('ask_2', 'ask'));
    expect(reloaded.hasAny()).toBe(false);
    expect(storage.data.has(INLINE_DRAFTS_STORAGE_KEY)).toBe(false);
  });

  it('成功回来只清发出时的那一句：期间改过的新字留着；点选项（没带字）不动草稿', () => {
    const drafts = new InlineDrafts();
    const key = askOpKey('ask_1', 'ask');
    drafts.set(key, '后来改写的一句');
    drafts.clearIfSent(key, '发出去的那一句');
    expect(drafts.get(key)).toBe('后来改写的一句');
    drafts.clearIfSent(key, undefined);
    expect(drafts.get(key)).toBe('后来改写的一句');
    drafts.clearIfSent(key, ' 后来改写的一句 ');
    expect(drafts.get(key)).toBe('');
  });

  it('有写了一半的一句：离开页面前要问一句', () => {
    const inlineDrafts = new InlineDrafts();
    const state = {
      noteDrafts: new NoteDrafts(),
      conversationUi: new ConversationUi(),
      outbox: new Outbox(),
      noteOps: new NoteOps(),
      inlineDrafts,
    };
    expect(hasUnsavedWork(state)).toBe(false);
    inlineDrafts.set(askOpKey('ask_1', 'ask'), '12 号那笔再看看');
    expect(hasUnsavedWork(state)).toBe(true);
  });
});
