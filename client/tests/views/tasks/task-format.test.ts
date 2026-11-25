import { describe, expect, it } from 'vitest';
import { timeText } from '../../../src/shell/time-text.ts';
import { nextText, runningFor } from '../../../src/views/tasks/task-format.ts';

const ZONE = 'Asia/Shanghai';
const NOW = new Date('2026-11-07T06:00:00Z');

describe('Tasks column timestamps', () => {
  it('next run formats as time today, Tomorrow, weekday within week, or M/D beyond', () => {
    expect(nextText('2026-11-07T07:00:00Z', NOW, ZONE)).toBe('15:00');
    expect(nextText('2026-11-08T00:00:00Z', NOW, ZONE)).toBe('明天 08:00');
    expect(nextText('2026-11-09T01:00:00Z', NOW, ZONE)).toBe('周一 09:00');
    expect(nextText('2026-11-20T01:00:00Z', NOW, ZONE)).toBe('11/20 09:00');
  });

  it('formats active duration in minutes and completed age in hours or Yesterday', () => {
    expect(runningFor('2026-11-07T05:48:00Z', NOW.getTime())).toBe('12 分');
    expect(runningFor(null, NOW.getTime())).toBeNull();
    expect(timeText('2026-11-07T04:00:00Z', NOW, ZONE)).toBe('12:00');
    expect(timeText('2026-11-06T04:00:00Z', NOW, ZONE)).toBe('昨天');
  });
});
