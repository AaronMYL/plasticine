// 时间一种写法（11-14 界面统一，设计稿「用词、时间、搜索框、多选、头像」）：刚刚 · 5 分钟前 · 09:42 · 昨天 · 周五 ·
// 11-14 · 2025-11-14；正文里「11 月 14 日」。按给的时区算哪天。

import { describe, expect, it } from 'vitest';
import { bodyDate, timeText } from '../../src/shell/time-text.ts';

const ZONE = 'Asia/Shanghai';
// 2026-11-14（周六）20:00，上海时间。
const NOW = new Date('2026-11-14T12:00:00Z');
const at = (local: string): string => new Date(`${local}+08:00`).toISOString();

describe('时间一种写法', () => {
  it('列表上的时间：刚刚、分钟前、今天的钟点、昨天、一周内星期几、今年月-日、往年年-月-日', () => {
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

  it('哪天按给的时区算：上海今天上午，在纽约是昨天晚上', () => {
    const morning = at('2026-11-14T11:00:00');
    expect(timeText(morning, NOW, ZONE)).toBe('11:00');
    expect(timeText(morning, NOW, 'America/New_York')).toBe('昨天');
  });

  it('以后的时间不写「前」：今天写钟点，别的天写日期', () => {
    expect(timeText(at('2026-11-14T21:30:00'), NOW, ZONE)).toBe('21:30');
    expect(timeText(at('2026-11-20T08:00:00'), NOW, ZONE)).toBe('11-20');
  });

  it('正文里的日期：「11 月 14 日」，不是今年的带上年', () => {
    expect(bodyDate(at('2026-11-09T08:30:00'), NOW, ZONE)).toBe('11 月 9 日');
    expect(bodyDate(at('2025-12-31T08:30:00'), NOW, ZONE)).toBe('2025 年 12 月 31 日');
  });
});
