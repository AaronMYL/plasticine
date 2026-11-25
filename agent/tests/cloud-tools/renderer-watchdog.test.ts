import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RendererWatchdog, SPIN_WINDOW_MS, WATCH_EVERY_MS } from '../../src/cloud-tools/index.ts';

test('kills renderer tab averaging >80% CPU over 30m; leaves normal, shorter, and non-page alone', async () => {
  let now = 0;
  const cpu = new Map<number, number>([[11, 0], [22, 0], [33, 0]]);
  const killed: number[] = [];
  const watchdog = new RendererWatchdog({
    processes: () => Promise.resolve([{ pid: 11, type: 'renderer', cpuSeconds: cpu.get(11)! },
      { pid: 22, type: 'renderer', cpuSeconds: cpu.get(22)! },
      { pid: 33, type: 'gpu-process', cpuSeconds: cpu.get(33)! }]),
    kill: (pid) => killed.push(pid),
    now: () => now,
    stopped: () => undefined,
    failed: (error) => assert.fail(String(error)),
  });
  const step = async (): Promise<number[]> => {
    now += WATCH_EVERY_MS;
    cpu.set(11, cpu.get(11)! + WATCH_EVERY_MS / 1000 * 0.95);
    cpu.set(22, cpu.get(22)! + WATCH_EVERY_MS / 1000 * 0.2);
    cpu.set(33, cpu.get(33)! + WATCH_EVERY_MS / 1000);
    return watchdog.check(AbortSignal.timeout(1000));
  };
  assert.deepEqual(await watchdog.check(AbortSignal.timeout(1000)), []);
  for (let elapsed = WATCH_EVERY_MS; elapsed < SPIN_WINDOW_MS; elapsed += WATCH_EVERY_MS) {
    assert.deepEqual(await step(), []);
  }
  assert.deepEqual(await step(), [11]);
  assert.deepEqual(killed, [11]);
});

test('skips renderer watchdog checks when browser is disconnected', async () => {
  const watchdog = new RendererWatchdog({ processes: () => Promise.resolve(null), kill: () => assert.fail('不该结束'),
    now: () => 0, stopped: () => undefined, failed: () => undefined });
  assert.deepEqual(await watchdog.check(AbortSignal.timeout(1000)), []);
});
