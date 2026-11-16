// 测试进程的时区：不管机器在哪、命令前带没带 TZ，界面测试都跑在上海时区（vite.config.ts 的 test.env）。
import { expect, it } from 'vitest';

it('测试跑在上海时区', () => {
  expect(new Date('2026-10-27T00:00:00+08:00').getDate()).toBe(27);
  expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-480);
});
