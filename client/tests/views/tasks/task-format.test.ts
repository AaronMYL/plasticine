// 任务栏目里的时间写法：下次、在做多久、做完多久以前。

import { describe, expect, it } from 'vitest';
import { agoText, nextText, runningFor } from '../../../src/views/tasks/task-format.ts';

const ZONE = 'Asia/Shanghai';
// 北京时间 2026-11-07（周六）14:00。
const NOW = new Date('2026-11-07T06:00:00Z');

describe('任务栏目的时间', () => {
  it('下次：今天写钟点，明天写「明天」，一周内写周几，再远写月/日', () => {
    expect(nextText('2026-11-07T07:00:00Z', NOW, ZONE)).toBe('15:00');
    expect(nextText('2026-11-08T00:00:00Z', NOW, ZONE)).toBe('明天 08:00');
    expect(nextText('2026-11-09T01:00:00Z', NOW, ZONE)).toBe('周一 09:00');
    expect(nextText('2026-11-20T01:00:00Z', NOW, ZONE)).toBe('11/20 09:00');
  });

  it('在做多久按分钟，做完多久以前按钟头和昨天', () => {
    expect(runningFor('2026-11-07T05:48:00Z', NOW.getTime())).toBe('12 分');
    expect(runningFor(null, NOW.getTime())).toBeNull();
    expect(agoText('2026-11-07T04:00:00Z', NOW, ZONE)).toBe('2 小时前');
    expect(agoText('2026-11-06T04:00:00Z', NOW, ZONE)).toBe('昨天');
  });
});
