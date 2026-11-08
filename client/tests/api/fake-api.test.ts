import { describe, expect, it, vi } from 'vitest';
import { ApiError, NoteConflictError } from '../../src/api/errors.ts';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { noteBytes, notePreview, noteTitle } from '../../src/api/fake/note-text.ts';
import type { LiveEvent } from '../../src/api/types.ts';
import { NOW } from '../helpers.tsx';

function signedIn() {
  const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
  fake.control.session.signInForDevelopment('测试机');
  return fake;
}

function collect(fake: ReturnType<typeof signedIn>): LiveEvent[] {
  const events: LiveEvent[] = [];
  fake.api.events.subscribe({ onEvent: (event) => events.push(event), onStatus: () => undefined });
  return events;
}

/** 假实现的流式回复用 0ms 计时器一段段推；等这么多轮足够推完一条。 */
const MAX_ROUNDS = 50;

async function until(check: () => boolean): Promise<void> {
  for (let round = 0; round < MAX_ROUNDS && !check(); round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function drain(): Promise<void> {
  await until(() => false);
}

describe('假接口 · session', () => {
  it('配对码换会话，用过一次就作废', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    const code = fake.control.session.issueCode();
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const session = await fake.api.session.pair({ code, deviceName: '书房的 Mac' });
    expect(session.device.name).toBe('书房的 Mac');
    expect(await fake.api.session.current()).toEqual(session);
    await expect(fake.api.session.pair({ code, deviceName: 'x' })).rejects.toMatchObject({
      kind: 'invalid',
      field: 'code',
    });
  });

  it('和真服务端一样：不带或换了 requestId，同一个码第二次就不对，不登记第二台设备', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    const code = fake.control.session.issueCode();
    await fake.api.session.pair({ code, deviceName: 'Mac', requestId: 'req_pair_0001' });
    const bare = fake.api.session.pair({ code, deviceName: 'Mac' });
    await expect(bare).rejects.toMatchObject({ code: 'pairing_code_invalid' });
    const other = fake.api.session.pair({ code, deviceName: 'Mac', requestId: 'req_pair_0002' });
    await expect(other).rejects.toMatchObject({ code: 'pairing_code_invalid' });
    expect(await fake.api.devices.list()).toHaveLength(1);
  });

  it('和真服务端一样：同一 requestId + 同一个码重发，给同一台设备一个新会话', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    const code = fake.control.session.issueCode();
    const first = await fake.api.session.pair({ code, deviceName: 'Mac', requestId: 'req_pair_0001' });
    const again = await fake.api.session.pair({ code, deviceName: 'Mac', requestId: 'req_pair_0001' });
    expect(again.device.id).toBe(first.device.id);
    expect(await fake.api.devices.list()).toHaveLength(1);
  });

  it('没有会话时请求拿到 401，并通知登录事件', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    const listener = vi.fn();
    fake.api.onUnauthorized(listener);
    await expect(fake.api.notes.list({})).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('假接口 · notes', () => {
  it('保存带 version：版本对得上就加一版，对不上 409 带当前版本，不覆盖', async () => {
    const fake = signedIn();
    const created = await fake.api.notes.create({ markdown: '# 新笔记\n\n第一段', requestId: 'c1' });
    const saved = await fake.api.notes.save(created.id, {
      markdown: '# 新笔记\n\n改过',
      version: created.version,
      requestId: 's1',
    });
    expect(saved.version).toBe(created.version + 1);
    const stale = fake.api.notes.save(created.id, {
      markdown: '旧底稿上的改动',
      version: created.version,
      requestId: 's2',
    });
    await expect(stale).rejects.toBeInstanceOf(NoteConflictError);
    expect((await fake.api.notes.get(created.id)).markdown).toBe('# 新笔记\n\n改过');
  });

  it('同一个 request_id 重发保存，返回同一版，不多出一版', async () => {
    const fake = signedIn();
    const created = await fake.api.notes.create({ markdown: 'a', requestId: 'c2' });
    const input = { markdown: 'b', version: created.version, requestId: 's3' };
    const first = await fake.api.notes.save(created.id, input);
    const again = await fake.api.notes.save(created.id, input);
    expect(again.version).toBe(first.version);
  });

  it('删除只是移到「最近删除」：列表里没了，事件流报一声', async () => {
    const fake = signedIn();
    const events = collect(fake);
    const created = await fake.api.notes.create({ markdown: '# 要删的', requestId: 'c3' });
    const deleted = await fake.api.notes.remove(created.id, 'd1');
    expect(deleted.deletedAt).not.toBeNull();
    expect(await fake.api.notes.list({})).toHaveLength(0);
    expect(events.some((event) => event.type === 'note.deleted')).toBe(true);
  });

  it('搜索按标题和预览找（服务端没有搜索接口，和真实现一样），中文也行', async () => {
    const fake = signedIn();
    await fake.api.notes.create({ markdown: '# 读书摘记\n\n关于时间', requestId: 'c4' });
    await fake.api.notes.create({ markdown: '# 购物\n\n牛奶', requestId: 'c5' });
    const found = await fake.api.notes.list({ q: '时间' });
    expect(found.map((note) => note.title)).toEqual(['读书摘记']);
  });

  it('标题取第一行非空文字，预览取其后，字节数按 UTF-8 算', () => {
    const markdown = '\n# 这周\n\n- [ ] 第一件\n![图](a.png)\n';
    expect(noteTitle(markdown)).toBe('这周');
    expect(notePreview(markdown)).toBe('第一件 ［图］');
    expect(noteBytes('一 二\n三')).toBe(11);
    expect(noteTitle('')).toBe('');
  });
});
