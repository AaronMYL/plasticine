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

function build(enabled: boolean) {
  return (requestId: string) => ({ requestId, version: 2, enabled });
}

describe('owner-confirmed request dispatch', () => {
  it('sends raw body and request ID without reading keys or attaching signature fields', async () => {
    const { api, sends } = recordingApi([async () => group({ enabled: false, version: 3 })]);
    const sender = new SignedSender({ api, ops: new SignedOps() });
    const result = await sender.send(KEY, '关掉工具组', '收件箱', TARGET, build(false));
    expect(result).toMatchObject({ kind: 'tool_group', group: { id: 'inbox' } });
    const sent = sends[0]!;
    expect(sent).toEqual({ target: TARGET, bodyText: sent.bodyText });
    expect(JSON.parse(sent.bodyText)).toEqual({ requestId: expect.stringMatching(/^req_/), version: 2,
      enabled: false });
  });

  it('recheck after lost receipt only queries receipt without re-signing or resending write', async () => {
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

  it('re-clicking with new input while unresolved checks original request first', async () => {
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

  it('403 signature error marks unsent keeping ID/body without treating as session expiry', async () => {
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

  it('resending unexecuted request keeps original ID and body without extra confirmation', async () => {
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

  it('explicit 409 version conflict marks rejected and mints new ID on next click', async () => {
    const conflict = new ApiError({ kind: 'conflict', code: 'version_conflict', message: '改过了', status: 409 });
    const { api, sends } = recordingApi([async () => Promise.reject(conflict), async () => group({ version: 4 })]);
    const ops = new SignedOps();
    const sender = new SignedSender({ api, ops });
    await sender.send(KEY, '关掉工具组', '收件箱', TARGET, build(false));
    expect(ops.get(KEY)?.status).toBe('failed');
    await sender.send(KEY, '关掉工具组', '收件箱', TARGET, build(false));
    expect(JSON.parse(sends[1]?.bodyText ?? '{}').requestId).not.toBe(JSON.parse(sends[0]?.bodyText ?? '{}').requestId);
  });

  it('persists ID and raw body in sessionStorage across reload and 401, marking in-flight check', () => {
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

  it('prompts before unload when unresolved signed requests remain', () => {
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
