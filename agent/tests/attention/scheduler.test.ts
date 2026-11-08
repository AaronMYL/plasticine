// 外环定时扫描（attention/scheduler.ts）：一个出错不拦其他的；异步扫描没跑完，下一轮不再起第二份（审查 2026-11-01）；
// 计时器 start 一次、stop 之后不再跑。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScanScheduler } from '../../src/attention/index.ts';
import { captureLogs } from '../safety-helpers.ts';

test('一个扫描抛错：记在状态里，不拦其他扫描，下一轮照跑', (context) => {
  captureLogs(context);
  const scheduler = new ScanScheduler();
  const ran: string[] = [];
  let fail = true;
  scheduler.add({ name: '坏的', run: () => {
    ran.push('坏的');
    if (fail) {
      throw new Error('扫描坏了');
    }
  } });
  scheduler.add({ name: '好的', run: () => ran.push('好的') });
  const first = scheduler.runOnce();
  assert.deepEqual(first.map((result) => result.ok), [false, true]);
  assert.deepEqual(ran, ['坏的', '好的']);
  assert.equal(scheduler.status().find((entry) => entry.name === '坏的')?.error, '扫描坏了');
  fail = false;
  scheduler.runOnce();
  assert.deepEqual(ran, ['坏的', '好的', '坏的', '好的']);
  assert.equal(scheduler.status().find((entry) => entry.name === '坏的')?.error, null);
});

test('异步扫描还在跑：下一轮跳过它、不起第二份；跑完后再跑；异步出错记进状态', async (context) => {
  captureLogs(context);
  const scheduler = new ScanScheduler();
  let release: (() => void) | undefined;
  let started = 0;
  let reject = false;
  scheduler.add({ name: '慢的', run: () => new Promise<void>((resolve, rejectRun) => {
    started += 1;
    release = () => (reject ? rejectRun(new Error('慢的坏了')) : resolve());
  }) });
  scheduler.add({ name: '快的', run: () => 'ok' });
  const first = scheduler.runOnce();
  assert.equal(first[0]?.ok, true);
  const second = scheduler.runOnce();
  assert.equal(started, 1, '上一轮还在跑，不起第二份');
  assert.equal(second[0]?.skipped, true);
  assert.equal(second[1]?.ok, true);
  release?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduler.status().find((entry) => entry.name === '慢的')?.running, false);
  reject = true;
  scheduler.runOnce();
  assert.equal(started, 2);
  release?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduler.status().find((entry) => entry.name === '慢的')?.error, '慢的坏了');
  assert.equal(scheduler.status().find((entry) => entry.name === '慢的')?.running, false);
});

test('start 两次只有一个计时器；stop 之后不再跑', async () => {
  const scheduler = new ScanScheduler({ tickMs: 5 });
  let runs = 0;
  scheduler.add({ name: '计数', run: () => { runs += 1; } });
  scheduler.start();
  scheduler.start();
  await new Promise((resolve) => setTimeout(resolve, 40));
  scheduler.stop();
  const after = runs;
  assert.ok(after >= 2 && after <= 9, `跑了 ${after} 次`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runs, after);
});
