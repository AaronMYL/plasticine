import { expect, it } from 'vitest';

it('tests run in Asia/Shanghai timezone', () => {
  expect(new Date('2026-10-27T00:00:00+08:00').getDate()).toBe(27);
  expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-480);
});
