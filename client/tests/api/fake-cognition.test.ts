// 本人确认依赖真实配对会话，不再依赖浏览器签名；请求标识、原请求体和版本检查继续生效。
import { describe, expect, it } from 'vitest';
import { generateDeviceKeyPair, publicJwkOf } from '../../src/api/device-signature.ts';
import { createFakeApi } from '../../src/api/fake/index.ts';
import type { SignedSend, SignedTarget } from '../../src/api/signed-targets.ts';
import { NOW } from '../helpers.tsx';

const TARGET: SignedTarget = { kind: 'agreement_edit', agreementId: 'agr_1' };
const BODY = '{"requestId":"req_abcdefgh","version":1,"text":"改好","scope":"范围"}';

function setup() {
  const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
  fake.control.session.signInForDevelopment('测试机');
  fake.control.session.backdate(11 * 60 * 1000);
  fake.control.agreements.seed({ id: 'agr_1', text: '原文', scope: '范围', state: 'active' });
  return fake;
}

describe('假实现 · 本人会话确认', () => {
  it.each<Partial<SignedSend>>([
    {}, { signedAt: '', signature: '' }, { signedAt: '2020-01-01T00:00:00.000Z', signature: 'bad' },
  ])('没有钥匙的老会话可确认，旧签名字段不再制造门槛：%j', async (legacy) => {
    const fake = setup();
    expect(await fake.api.deviceKeys.current()).toBeNull();
    const request = { target: TARGET, bodyText: BODY, ...legacy };
    const first = await fake.api.signed.send(request);
    const again = await fake.api.signed.send(request);
    expect(first).toMatchObject({ kind: 'agreement', agreement: { text: '改好', version: 2 } });
    expect(again).toEqual(first);
    expect(fake.control.agreements.find('agr_1')?.version).toBe(2);
  });

  it('同一个 requestId 换了请求体仍被拒，不覆盖已确认内容', async () => {
    const fake = setup();
    await fake.api.signed.send({ target: TARGET, bodyText: BODY });
    await expect(fake.api.signed.send({ target: TARGET, bodyText: BODY.replace('改好', '另一版') }))
      .rejects.toMatchObject({ code: 'request_id_reused', status: 409 });
    expect(fake.control.agreements.find('agr_1')?.text).toBe('改好');
  });

  const targets: SignedTarget[] = [
    TARGET,
    { kind: 'agreement_confirm', agreementId: 'agr_1' },
    { kind: 'device_action_answer', askId: 'ask_1' },
    { kind: 'backup_restore', backupId: 'backup_1' },
    { kind: 'money_draft_confirm', draftId: 'draft_1' },
    { kind: 'note_unlock', noteId: 'note_1' },
    { kind: 'node_pairing_code' },
    { kind: 'node_limits', nodeId: 'node_1' },
    { kind: 'tool_group', groupId: 'group_1' },
    { kind: 'memory_uncertain', uncertainId: 'uncertain_1' },
  ];
  it.each(targets.filter((target) => target.kind !== 'note_unlock'))('系统会话不能写本人确认：$kind', async (target) => {
    const fake = setup();
    fake.control.session.signInForDevelopment('Plasticine 浏览器', 'system');
    await expect(fake.api.signed.send({ target, bodyText: BODY }))
      .rejects.toMatchObject({ code: 'user_confirmation_required', status: 403 });
    expect(fake.control.agreements.find('agr_1')?.text).toBe('原文');
  });
  it.each(targets)('会话已失效仍需登录：$kind', async (target) => {
    const fake = setup();
    fake.control.session.expire();
    await expect(fake.api.signed.send({ target, bodyText: BODY }))
      .rejects.toMatchObject({ code: 'unauthorized', status: 401 });
    expect(fake.control.agreements.find('agr_1')?.text).toBe('原文');
  });
});

it('保留旧钥匙登记接口的兼容行为，不会自动扩展其登记时间窗口', async () => {
  const fake = setup();
  const publicKey = await publicJwkOf((await generateDeviceKeyPair()).publicKey);
  const body = JSON.stringify({ requestId: 'req_register1', publicKey });
  await expect(fake.api.deviceKeys.register(body)).rejects.toMatchObject({ code: 'device_key_too_late', status: 403 });
});
