// 本人确认请求经 SignedSender 发，重试沿用 requestId 和原样请求体，不再依赖浏览器签名；
// 标识连同请求体存进 sessionStorage，刷新后还在；403 签名类错误是「没送到」，不触发重新配对。

import { describe, expect, it } from 'vitest';
import type { SignedApi } from '../../src/api/client.ts';
import { ApiError, unauthorizedError, uncertainError } from '../../src/api/errors.ts';
import type { SignedSend } from '../../src/api/signed-targets.ts';
import type { ToolGroupView } from '../../src/api/shared.ts';
import { hasUnsavedWork } from '../../src/shell/unsaved-guard.ts';
import { ConversationUi } from '../../src/state/conversation-ui.ts';
import { NoteDrafts } from '../../src/state/note-drafts.ts';
import { NoteOps } from '../../src/state/note-ops.ts';
import { Outbox } from '../../src/state/outbox.ts';
import { SIGNED_OPS_STORAGE_KEY, SignedOps } from '../../src/state/signed-ops.ts';
import { SignedSender } from '../../src/views/signing/signed-sender.ts';
import { memoryStorage } from '../helpers.tsx';

// 拿工具组的开关当例子（旧约定退役以后，本人确认的写操作里它最简单）。
const TARGET = { kind: 'tool_group', groupId: 'inbox' } as const;
const KEY = 'tool-group:inbox';

it.each(['result_expired', 'result_scope_mismatch'])('签名回执查询受限 %s 仍待核实，不能变成重签重发', (code) => {
  const ops = new SignedOps();
  ops.begin(KEY, '关掉工具组', '收件箱', TARGET, (requestId) => ({ requestId, enabled: false, version: 1 }));
  ops.fail(KEY, uncertainError('回执丢了'));
  ops.retry(KEY);
  ops.fail(KEY, new ApiError({ kind: 'failed', code, status: 410, message: '不能读取回执' }));
  expect(ops.get(KEY)).toMatchObject({ status: 'uncertain', unresolved: true });
});

function group(fields: Partial<ToolGroupView> = {}): ToolGroupView {
  return { id: 'inbox', label: '收件箱', description: '', tools: [], enabled: true, version: 2, confirmedAt: null,
    ...fields };
}

function recordingApi(answers: Array<(send: SignedSend) => Promise<ToolGroupView>>) {
  const sends: SignedSend[] = [];
  const api: SignedApi = {
    lookup: async () => {
      const answer = answers.shift();
      const sent = sends.at(-1);
      if (answer === undefined || sent === undefined) {
        return null;
      }
      return { kind: 'tool_group', group: await answer(sent) };
    },
    send: async (request) => {
      sends.push(request);
      const answer = answers.shift();
      if (answer === undefined) {
        throw new Error('假服务端没准备回答');
      }
      return { kind: 'tool_group', group: await answer(request) };
    },
  };
  return { api, sends };
}

/** 开关工具组的请求体；两次点的内容不一样（一次关、一次开）。 */
function build(enabled: boolean) {
  return (requestId: string) => ({ requestId, version: 2, enabled });
}

describe('本人确认请求的发送', () => {
  it('原样发送请求体和标识，不读取钥匙也不附带签名字段', async () => {
    const { api, sends } = recordingApi([async () => group({ enabled: false, version: 3 })]);
    const sender = new SignedSender({ api, ops: new SignedOps() });
    const result = await sender.send(KEY, '关掉工具组', '收件箱', TARGET, build(false));
    expect(result).toMatchObject({ kind: 'tool_group', group: { id: 'inbox' } });
    const sent = sends[0]!;
    expect(sent).toEqual({ target: TARGET, bodyText: sent.bodyText });
    expect(JSON.parse(sent.bodyText)).toEqual({ requestId: expect.stringMatching(/^req_/), version: 2,
      enabled: false });
  });

  it('回执丢了再核实：只读回执，不再次签名或发送写请求', async () => {
    const { api, sends } = recordingApi([
      async () => Promise.reject(uncertainError('开关工具组')),
      async () => group({ enabled: false, version: 3 }),
    ]);
    const ops = new SignedOps();
    const sender = new SignedSender({ api, ops });
    expect(await sender.send(KEY, '关掉工具组', '收件箱', TARGET, build(false))).toBeNull();
    expect(ops.get(KEY)).toMatchObject({ status: 'uncertain', unresolved: true });
    await sender.retry(KEY);
    expect(sends).toHaveLength(1);
    expect(ops.get(KEY)).toBeUndefined();
  });

  it('上一次还没了结时又点了一次（填了别的数）：先核实原来那一次，不拿同一个标识发别的内容', async () => {
    const { api, sends } = recordingApi([
      async () => Promise.reject(uncertainError('开关工具组')),
      async () => group({ enabled: false, version: 3 }),
    ]);
    const ops = new SignedOps();
    const sender = new SignedSender({ api, ops });
    await sender.send(KEY, '关掉工具组', '收件箱', TARGET, build(false));
    await sender.send(KEY, '打开工具组', '收件箱', TARGET, build(true));
    expect(JSON.parse(sends[1]?.bodyText ?? '{}').enabled).toBe(false);
    expect(sends[1]?.bodyText).toBe(sends[0]?.bodyText);
  });

  it('403 签名类错误：这次没执行，状态是「没送到」，标识和请求体留着；不当成会话失效', async () => {
    const refused = new ApiError({
      kind: 'invalid',
      code: 'signature_expired',
      message: '这次签名已经过期，没有执行。',
      next: '在这台设备上重新签一次再发（同一个 requestId、同样的内容）。',
      status: 403,
    });
    const { api, sends } = recordingApi([async () => Promise.reject(refused), async () => group({ version: 3 })]);
    const ops = new SignedOps();
    const sender = new SignedSender({ api, ops });
    await sender.send(KEY, '关掉工具组', '收件箱', TARGET, build(false));
    expect(ops.get(KEY)).toMatchObject({ status: 'unsent', error: expect.stringContaining('过期') });
    await sender.retry(KEY);
    expect(sends[1]?.bodyText).toBe(sends[0]?.bodyText);
    expect(ops.get(KEY)).toBeUndefined();
  });

  it('未执行的请求重发保持原标识和原正文，不引入新的确认步骤', async () => {
    const { api, sends } = recordingApi([async () => Promise.reject(unauthorizedError()),
      async () => group({ version: 3 })]);
    const ops = new SignedOps();
    const sender = new SignedSender({ api, ops });
    await sender.send(KEY, '关掉工具组', '收件箱', TARGET, build(false));
    expect(ops.get(KEY)).toMatchObject({ status: 'unsent' });
    await sender.retry(KEY);
    expect(sends).toHaveLength(2);
    expect(sends[1]).toEqual(sends[0]);
    expect(ops.get(KEY)).toBeUndefined();
  });

  it('服务端明确拒了（409 版本冲突）：被拒，下一次点换新标识', async () => {
    const conflict = new ApiError({ kind: 'conflict', code: 'version_conflict', message: '改过了', status: 409 });
    const { api, sends } = recordingApi([async () => Promise.reject(conflict), async () => group({ version: 4 })]);
    const ops = new SignedOps();
    const sender = new SignedSender({ api, ops });
    await sender.send(KEY, '关掉工具组', '收件箱', TARGET, build(false));
    expect(ops.get(KEY)?.status).toBe('failed');
    await sender.send(KEY, '关掉工具组', '收件箱', TARGET, build(false));
    expect(JSON.parse(sends[1]?.bodyText ?? '{}').requestId).not.toBe(JSON.parse(sends[0]?.bodyText ?? '{}').requestId);
  });

  it('另存进 sessionStorage（标识 + 原样请求体）：刷新后还在，在路上的算待核实；401 之后也还在', () => {
    const storage = memoryStorage();
    const ops = new SignedOps(storage);
    const op = ops.begin(KEY, '关掉工具组', '收件箱', TARGET, build(false));
    expect(storage.data.get(SIGNED_OPS_STORAGE_KEY)).toContain(op.requestId);
    const reloaded = new SignedOps(storage);
    expect(reloaded.get(KEY)).toMatchObject({ status: 'uncertain', unresolved: true, bodyText: op.bodyText });
    reloaded.retry(KEY);
    reloaded.fail(KEY, unauthorizedError());
    expect(reloaded.get(KEY)).toMatchObject({ status: 'uncertain', requestId: op.requestId });
  });

  it('还有没了结的签名请求：离开页面前要问一句', () => {
    const signedOps = new SignedOps();
    const state = {
      noteDrafts: new NoteDrafts(),
      conversationUi: new ConversationUi(),
      outbox: new Outbox(),
      noteOps: new NoteOps(),
      signedOps,
    };
    expect(hasUnsavedWork(state)).toBe(false);
    signedOps.begin(KEY, '关掉工具组', '收件箱', TARGET, build(false));
    expect(hasUnsavedWork(state)).toBe(true);
  });
});
