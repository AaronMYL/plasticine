// 装服务器时问 @账号或域名（11-12《首次使用解耦》）：--handle 先入网（名字先用 @账号占着），打印 @账号网址的链接、
// 要重启服务；--domain 存成自己的网址、打印这个域名的链接；@账号不合规矩不入网；已经有主人只说一句。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storedOwnUrl } from '../../src/app/own-url.ts';
import { setupLink } from '../../src/app/setup-link-run.ts';
import { openTestState } from '../state/helpers.ts';

function fakeRelay(calls: { handle: string; displayName: string }[]) {
  return () => ({
    registerFor: async (input: { handle: string; displayName: string; signingKey: string; encryptionKey: string }) => {
      calls.push({ handle: input.handle, displayName: input.displayName });
      return { account: { id: 'acct-setup-link-01', handle: input.handle, displayName: input.displayName,
        signingKey: input.signingKey, encryptionKey: input.encryptionKey }, invitedBy: null };
    },
  });
}

const base = { env: {}, now: new Date('2026-11-12T08:00:00Z'), port: 8790, relayUrl: 'https://cyberhunter.top' };

test('--handle：先入网，链接用 @账号的网址，本机那行也在；要重启服务', async () => {
  const t = await openTestState();
  try {
    const calls: { handle: string; displayName: string }[] = [];
    const result = await setupLink({ ...base, state: t.state, handle: '@Li_Ming', client: fakeRelay(calls) });
    assert.deepEqual(calls, [{ handle: 'li_ming', displayName: 'li_ming' }]);
    assert.equal(result.joined, true);
    assert.equal(t.state.networkIdentity.get()?.handle, 'li_ming');
    assert.match(result.lines.join('\n'), /https:\/\/li-ming\.cyberhunter\.top\/#\/setup\?t=/);
    assert.match(result.lines.join('\n'), /http:\/\/127\.0\.0\.1:8790\/#\/setup\?t=/);
    const again = await setupLink({ ...base, state: t.state, handle: 'li_ming', client: fakeRelay(calls) });
    assert.equal(again.joined, false, '已经是这个 @账号：不再注册');
    assert.equal(calls.length, 1);
  } finally {
    await t.cleanup();
  }
});

test('--handle 不合规矩：不入网', async () => {
  const t = await openTestState();
  try {
    const calls: { handle: string; displayName: string }[] = [];
    await assert.rejects(setupLink({ ...base, state: t.state, handle: 'a-b', client: fakeRelay(calls) }), /@账号/);
    assert.equal(calls.length, 0);
    assert.equal(t.state.networkIdentity.get(), undefined);
  } finally {
    await t.cleanup();
  }
});

test('--domain：存成自己的网址，链接用这个域名', async () => {
  const t = await openTestState();
  try {
    const result = await setupLink({ ...base, state: t.state, domain: 'plasticine.example.test',
      client: fakeRelay([]) });
    assert.equal(storedOwnUrl(t.state), 'https://plasticine.example.test');
    assert.match(result.lines.join('\n'), /https:\/\/plasticine\.example\.test\/#\/setup\?t=/);
    assert.equal(result.joined, false);
  } finally {
    await t.cleanup();
  }
});

test('已经有主人：只说一句，不入网', async () => {
  const t = await openTestState();
  try {
    const at = base.now.toISOString();
    t.state.devices.create({ name: '老手机', firstSeenAt: at, lastSeenAt: at });
    const calls: { handle: string; displayName: string }[] = [];
    const result = await setupLink({ ...base, state: t.state, handle: 'li_ming', client: fakeRelay(calls) });
    assert.match(result.lines[0] ?? '', /已经有主人了/);
    assert.equal(calls.length, 0);
  } finally {
    await t.cleanup();
  }
});
