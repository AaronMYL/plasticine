import { HARD_LINES } from './act-or-ask.ts';

export function hardLines(): readonly string[] {
  return HARD_LINES;
}

export const HARD_LINES_HEADING = '先问你';
export const HARD_LINES_NOTE = '不管有没有把握，这几类都先问你；代码里也拦着，不靠 Plasticine 自觉。';

export function hardLinesForModel(): string[] {
  return hardLines().map((line) => line.replaceAll('你', '用户'));
}
