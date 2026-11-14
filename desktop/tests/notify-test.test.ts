// 测试通知（第13批）：弹出来了、系统拒了（带原因）、系统不回话、开关关着、不支持，各说一句。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testNotice, type NoticeLike } from '../src/app/notify-test.ts';

function notice(behaviour: 'show' | 'failed' | 'silent'): NoticeLike {
  const listeners: Record<string, (...args: unknown[]) => void> = {};
  return {
    on: (event: string, listener: (...args: unknown[]) => void) => { listeners[event] = listener; },
    show: () => {
      if (behaviour === 'show') listeners['show']?.();
      if (behaviour === 'failed') listeners['failed']?.({}, 'Notifications are not allowed');
    },
  } as NoticeLike;
}

test('弹出来了 / 系统拒了 / 不回话 / 开关关着 / 不支持', async () => {
  const on = { supported: true, enabled: true, waitMs: 20 };
  assert.deepEqual(await testNotice(() => notice('show'), on), { shown: true, error: null });
  const failed = await testNotice(() => notice('failed'), on);
  assert.equal(failed.shown, false);
  assert.match(failed.error ?? '', /系统没让 Plasticine 发通知（Notifications are not allowed）/);
  assert.match((await testNotice(() => notice('silent'), on)).error ?? '', /系统没有回话/);
  assert.match((await testNotice(() => notice('show'), { ...on, enabled: false })).error ?? '', /开关关着/);
  assert.match((await testNotice(() => notice('show'), { ...on, supported: false })).error ?? '', /不支持/);
});
