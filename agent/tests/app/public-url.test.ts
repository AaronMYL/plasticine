// 第 7 批第 14 条：Plasticine 写的链接不再是 IP。环境变量 > 主人 @账号的网址（下划线换连字符，入网了才有）> 本机地址；
// 按需取，入网之后不用重启就换成 @账号的网址；内核提示词里的网页地址跟着走。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateIdentityKeys } from '../../src/network/index.ts';
import { configuredPublicUrl, publicUrlSource } from '../../src/app/public-url.ts';
import { identitySection } from '../../src/lines/prompt.ts';
import { openTestState } from '../state/helpers.ts';

function join(state: Awaited<ReturnType<typeof openTestState>>['state'], handle: string, relayUrl: string): void {
  const keys = generateIdentityKeys();
  state.networkIdentity.create({ accountId: 'acct-public-url-01', handle, displayName: 'Alex', relayUrl,
    signingPublicKey: keys.signing.publicKey, signingPrivateKey: keys.signing.privateKey,
    encryptionPublicKey: keys.encryption.publicKey, encryptionPrivateKey: keys.encryption.privateKey,
    joinedAt: '2026-11-08T09:00:00.000Z' });
}

test('没入网、没配环境变量：本机地址（端口跟着 PLASTICINE_PORT），不再是 IP', async () => {
  const t = await openTestState();
  try {
    assert.equal(publicUrlSource(t.state, {})(), 'http://127.0.0.1:8790');
    assert.equal(publicUrlSource(t.state, { PLASTICINE_PORT: '9100' })(), 'http://127.0.0.1:9100');
    assert.doesNotMatch(identitySection(publicUrlSource(t.state, {})()), /43\.156\.80\.111/);
  } finally {
    await t.cleanup();
  }
});

test('有 @账号：https://<handle 下划线换连字符>.cyberhunter.top；入网之后不用重启就换过来', async () => {
  const t = await openTestState();
  try {
    const url = publicUrlSource(t.state, {});
    assert.equal(url(), 'http://127.0.0.1:8790');
    join(t.state, 'li_ming', 'https://cyberhunter.top');
    assert.equal(url(), 'https://li-ming.cyberhunter.top');
    assert.match(identitySection(url()), /网页 https:\/\/li-ming\.cyberhunter\.top/);
  } finally {
    await t.cleanup();
  }
});

test('和中继在同一台机器上（身份里记的是本机口）：主域名回落到 cyberhunter.top', async () => {
  const t = await openTestState();
  try {
    join(t.state, 'alex', 'http://127.0.0.1:8791');
    assert.equal(publicUrlSource(t.state, { PLASTICINE_NETWORK_URL: 'http://127.0.0.1:8791' })(),
      'https://alex.cyberhunter.top');
  } finally {
    await t.cleanup();
  }
});

test('配了 PLASTICINE_PUBLIC_URL：用它（去掉末尾斜杠），@账号也不管；写错了装配时就报', async () => {
  const t = await openTestState();
  try {
    join(t.state, 'alex', 'https://cyberhunter.top');
    const env = { PLASTICINE_PUBLIC_URL: 'https://plasticine.example.test/' };
    assert.equal(publicUrlSource(t.state, env)(), 'https://plasticine.example.test');
    assert.equal(configuredPublicUrl({ PLASTICINE_PUBLIC_URL: ' ' }), null);
    assert.throws(() => publicUrlSource(t.state, { PLASTICINE_PUBLIC_URL: 'https://a.test/?x=1' }),
      /PLASTICINE_PUBLIC_URL/);
  } finally {
    await t.cleanup();
  }
});
