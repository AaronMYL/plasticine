// 本人确认依赖真实配对会话，不再依赖浏览器签名；请求标识、原请求体和版本检查继续生效。
import { describe, expect, it } from 'vitest';
import { createFakeApi } from '../../src/api/fake/index.ts';
import type { SignedSend, SignedTarget } from '../../src/api/signed-targets.ts';
import { NOW } from '../helpers.tsx';

// 拿「拿不准的一条说对」当例子（旧约定退役以后，本人确认的写操作里假实现现成有种子的一种）。
const TARGET: SignedTarget = { kind: 'tool_group', groupId: 'inbox' };
const BODY = '{"requestId":"req_abcdefgh","version":0,"enabled":false}';

function setup() {
  const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
  fake.control.session.signInForDevelopment('测试机');
  fake.control.session.backdate(11 * 60 * 1000);
  return fake;
}

const inbox = async (fake: ReturnType<typeof setup>) =>
  (await fake.api.toolGroups.list()).groups.find((group) => group.id === 'inbox');

describe('假实现 · 本人会话确认', () => {
  it.each<Partial<SignedSend>>([
    {}, { signedAt: '', signature: '' }, { signedAt: '2020-01-01T00:00:00.000Z', signature: 'bad' },
  ])('没有钥匙的老会话可确认，旧签名字段不再制造门槛：%j', async (legacy) => {
    const fake = setup();
    const request = { target: TARGET, bodyText: BODY, ...legacy };
    const first = await fake.api.signed.send(request);
    const again = await fake.api.signed.send(request);
    expect(first).toMatchObject({ kind: 'tool_group', group: { enabled: false, version: 1 } });
    expect(again).toEqual(first);
    expect((await inbox(fake))?.version).toBe(1);
  });

  it('同一个 requestId 换了请求体仍被拒，不覆盖已确认内容', async () => {
    const fake = setup();
    await fake.api.signed.send({ target: TARGET, bodyText: BODY });
    await expect(fake.api.signed.send({ target: TARGET, bodyText: BODY.replace('false', 'true') }))
      .rejects.toMatchObject({ code: 'request_id_reused', status: 409 });
    expect((await inbox(fake))?.enabled).toBe(false);
  });

  const targets: SignedTarget[] = [
    TARGET,
    { kind: 'device_action_answer', askId: 'ask_1' },
    { kind: 'backup_restore', backupId: 'backup_1' },
    { kind: 'money_draft_confirm', draftId: 'draft_1' },
    { kind: 'note_unlock', noteId: 'note_1' },
    { kind: 'node_pairing_code' },
    { kind: 'node_limits', nodeId: 'node_1' },
    { kind: 'memory_uncertain', uncertainId: 'uncertain_1' },
  ];
  it.each(targets.filter((target) => target.kind !== 'note_unlock'))('系统会话不能写本人确认：$kind', async (target) => {
    const fake = setup();
    fake.control.session.signInForDevelopment('Plasticine 浏览器', 'system');
    await expect(fake.api.signed.send({ target, bodyText: BODY }))
      .rejects.toMatchObject({ code: 'user_confirmation_required', status: 403 });
    fake.control.session.signInForDevelopment('测试机');
    expect((await inbox(fake))?.version).toBe(0);
  });
  it.each(targets)('会话已失效仍需登录：$kind', async (target) => {
    const fake = setup();
    fake.control.session.expire();
    await expect(fake.api.signed.send({ target, bodyText: BODY }))
      .rejects.toMatchObject({ code: 'unauthorized', status: 401 });
  });
});
