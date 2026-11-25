import { describe, expect, it } from 'vitest';
import { PAGE_STEPS_IDLE_MS, PAGE_STEPS_MAX, PageSteps } from '../../src/state/page-steps.ts';

const at = (seconds: number): Date => new Date(Date.UTC(2026, 10, 4, 2, 0, seconds));

describe('web page action steps', () => {
  it('merges working-to-done updates into one row per step and isolates steps by tab', () => {
    const steps = new PageSteps();
    steps.apply({ type: 'operate', tabId: 't1', actionId: 'a1', status: 'run', step: '填姓名、手机' }, at(0));
    steps.apply({ type: 'operate', tabId: 't1', actionId: 'a1', status: 'done', step: '填了姓名、手机' }, at(1));
    steps.apply({ type: 'operate', tabId: 't1', actionId: 'a2', status: 'run', step: '在看还有哪些没填' }, at(2));
    steps.apply({ type: 'operate', tabId: 't2', actionId: 'b1', status: 'wait', step: '要提交了' }, at(3));
    expect(steps.recent('t1', at(4)).map((step) => [step.status, step.text])).toEqual([
      ['done', '填了姓名、手机'], ['run', '在看还有哪些没填'],
    ]);
    expect(steps.recent('t2', at(4))).toHaveLength(1);
    expect(steps.recent('t3', at(4))).toEqual([]);
  });

  it('keeps only recent steps and hides aged entries', () => {
    const steps = new PageSteps();
    for (let index = 0; index < PAGE_STEPS_MAX + 3; index += 1) {
      steps.apply({ type: 'operate', tabId: 't1', actionId: `a${index}`, status: 'done', step: `第 ${index} 步` },
        at(index));
    }
    const recent = steps.recent('t1', at(PAGE_STEPS_MAX + 3));
    expect(recent).toHaveLength(PAGE_STEPS_MAX);
    expect(recent.at(-1)?.text).toBe(`第 ${PAGE_STEPS_MAX + 2} 步`);
    const later = new Date(at(PAGE_STEPS_MAX + 2).getTime() + PAGE_STEPS_IDLE_MS + 1);
    expect(steps.recent('t1', later)).toEqual([]);
  });
});
