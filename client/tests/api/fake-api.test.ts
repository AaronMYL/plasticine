import { describe, expect, it, vi } from 'vitest';
import { ApiError, NoteConflictError } from '../../src/api/errors.ts';
import { FAKE_LOCAL_TOKEN } from '../../src/api/fake/fake-account.ts';
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
  it('建账号：只在没有主人时成，要本机令牌或建账号链接令牌；成了登记设备、主线放一条欢迎', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    fake.control.account.seedFresh();
    expect((await fake.api.account.state()).setup).toBe('needed');
    const input = { displayName: 'Alex', handle: 'alex', password: 'fake-pass-1234', deviceName: 'Mac' };
    await expect(fake.api.account.setup(input, null)).rejects.toMatchObject({ code: 'setup_token_invalid' });
    const answer = await fake.api.account.setup(input, FAKE_LOCAL_TOKEN);
    expect(answer.network).toEqual({ joined: true, url: 'https://alex.cyberhunter.top', problem: null });
    expect(await fake.api.session.current()).toEqual(answer.session);
    expect(await fake.api.account.state()).toMatchObject({ setup: 'done', handle: 'alex', passwordSet: true });
    await expect(fake.api.account.setup(input, FAKE_LOCAL_TOKEN)).rejects.toMatchObject({ code: 'already_set_up' });
    const main = await fake.api.lines.read('main', {});
    expect(main.messages.map((message) => message.role)).toEqual(['welcome']);
    expect(main.messages[0]?.starts?.map((start) => start.icon)).toEqual(['notes', 'feed', 'conversation']);
  });

  it('密码登录：不对就 login_failed，连错 5 次限流 too_many_attempts；本机令牌登录的设备记成 local', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(fake.api.account.signIn({ password: 'nope', deviceName: 'x' }))
        .rejects.toMatchObject({ code: 'login_failed' });
    }
    await expect(fake.api.account.signIn({ password: 'fake-password', deviceName: 'x' }))
      .rejects.toMatchObject({ code: 'too_many_attempts', status: 429 });
    const local = await fake.api.account.signInLocal('Mac', FAKE_LOCAL_TOKEN);
    expect(local.device.local).toBe(true);
    await expect(fake.api.account.signInLocal('Mac', 'not-it')).rejects.toMatchObject({ code: 'local_only' });
  });

  it('@账号能不能用：格式按中继（小写字母、数字、下划线 3–24 位），下划线在网址里换成连字符', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    expect(await fake.api.account.handle('alex_li')).toEqual({ handle: 'alex_li', available: true, reason: null });
    expect((await fake.api.account.handle('al-ex')).reason).toBe('invalid');
    expect((await fake.api.account.handle('taken')).reason).toBe('taken');
    expect((await fake.api.account.handle('admin')).reason).toBe('reserved');
    fake.control.account.seedFresh();
    await fake.api.account.setup({ displayName: 'A', handle: 'alex_li', password: 'fake-pass-1234',
      deviceName: 'Mac' }, FAKE_LOCAL_TOKEN);
    expect((await fake.api.account.state()).networkUrl).toBe('https://alex-li.cyberhunter.top');
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
