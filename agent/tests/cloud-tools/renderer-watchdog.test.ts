import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RendererWatchdog, SPIN_WINDOW_MS, WATCH_EVERY_MS } from '../../src/cloud-tools/index.ts';

// 11-16：云端浏览器里一个网页空转了两天、占一核；空转超过 30 分钟（平均八成一核以上）自动结束那个进程。
test('网页进程 30 分钟里平均占一核八成以上就结束它；正常的、不够 30 分钟的、不是网页的不动', async () => {
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

test('浏览器没连着就什么都不看', async () => {
  const watchdog = new RendererWatchdog({ processes: () => Promise.resolve(null), kill: () => assert.fail('不该结束'),
    now: () => 0, stopped: () => undefined, failed: () => undefined });
  assert.deepEqual(await watchdog.check(AbortSignal.timeout(1000)), []);
});
