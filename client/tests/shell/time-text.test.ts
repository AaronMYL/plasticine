import { describe, expect, it } from 'vitest';
import { bodyDate, timeText } from '../../src/shell/time-text.ts';

const ZONE = 'Asia/Shanghai';
const NOW = new Date('2026-11-14T12:00:00Z');
const at = (local: string): string => new Date(`${local}+08:00`).toISOString();

describe('unified time formatting', () => {
  it('list timestamps format just-now, minutes ago, clock, yesterday, weekday, month-day, full', () => {
    expect(timeText(at('2026-11-14T19:59:30'), NOW, ZONE)).toBe('刚刚');
    expect(timeText(at('2026-11-14T19:55:00'), NOW, ZONE)).toBe('5 分钟前');
    expect(timeText(at('2026-11-14T09:42:00'), NOW, ZONE)).toBe('09:42');
    expect(timeText(at('2026-11-14T00:05:00'), NOW, ZONE)).toBe('00:05');
    expect(timeText(at('2026-11-13T23:50:00'), NOW, ZONE)).toBe('昨天');
    expect(timeText(at('2026-11-13T00:10:00'), NOW, ZONE)).toBe('昨天');
    expect(timeText(at('2026-11-12T08:00:00'), NOW, ZONE)).toBe('周四');
    expect(timeText(at('2026-11-08T08:00:00'), NOW, ZONE)).toBe('周日');
    expect(timeText(at('2026-11-07T08:00:00'), NOW, ZONE)).toBe('11-07');
    expect(timeText(at('2026-01-02T08:00:00'), NOW, ZONE)).toBe('01-02');
    expect(timeText(at('2025-11-14T08:00:00'), NOW, ZONE)).toBe('2025-11-14');
  });

  it('day boundaries follow given timezone (Shanghai morning is New York previous night)', () => {
    const morning = at('2026-11-14T11:00:00');
    expect(timeText(morning, NOW, ZONE)).toBe('11:00');
    expect(timeText(morning, NOW, 'America/New_York')).toBe('昨天');
  });

  it('future timestamps omit ago, showing clock time today or date on other days', () => {
    expect(timeText(at('2026-11-14T21:30:00'), NOW, ZONE)).toBe('21:30');
    expect(timeText(at('2026-11-20T08:00:00'), NOW, ZONE)).toBe('11-20');
  });

  it('body dates format as month-day in current year and include year otherwise', () => {
    expect(bodyDate(at('2026-11-09T08:30:00'), NOW, ZONE)).toBe('11 月 9 日');
    expect(bodyDate(at('2025-12-31T08:30:00'), NOW, ZONE)).toBe('2025 年 12 月 31 日');
  });
});
