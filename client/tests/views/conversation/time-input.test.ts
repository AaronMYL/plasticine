import { expect, it } from 'vitest';
import { fromTimeInput, timeInput, formatClock } from '../../../src/primitives/message/states.ts';

it('datetime input/display roundtrips in user timezone without machine tz or seconds', () => {
  const iso = '2026-10-28T02:30:27.000Z';
  expect(timeInput(iso, 'Asia/Shanghai')).toBe('2026-10-28T10:30');
  expect(fromTimeInput('2026-10-28T10:30', 'Asia/Shanghai')).toBe('2026-10-28T02:30:00.000Z');
  expect(formatClock(iso, true, 'Asia/Shanghai')).toBe('10/28 10:30');
  expect(fromTimeInput('2026-10-28T10:30', 'America/Chicago')).toBe('2026-10-28T15:30:00.000Z');
});

it('rejects nonexistent DST local times while still reading back valid timestamps', () => {
  expect(fromTimeInput('2026-03-08T02:30', 'America/Chicago')).toBeNull();
  expect(fromTimeInput('2026-03-08T03:30', 'America/Chicago')).toBe('2026-03-08T08:30:00.000Z');
});
