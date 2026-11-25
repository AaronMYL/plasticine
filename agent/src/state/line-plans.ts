import { Value } from 'typebox/value';
import { LINE_PLAN_STEPS_MAX, LinePlanStepSchema, type LinePlanStep } from '../../shared/api/lines.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

function stepsOf(value: unknown): LinePlanStep[] | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) && parsed.length <= LINE_PLAN_STEPS_MAX
    && parsed.every((step) => Value.Check(LinePlanStepSchema, step)) ? parsed as LinePlanStep[] : null;
}

export function createLinePlanStore(context: StoreContext) {
  const { db } = context;
  return {
    get(lineId: string): LinePlanStep[] | null {
      return stepsOf(db.get('SELECT plan FROM lines WHERE id = $lineId', { lineId })?.['plan']);
    },
    set(lineId: string, steps: readonly LinePlanStep[] | null): void {
      const plan = steps === null ? null : JSON.stringify(steps);
      if (db.run('UPDATE lines SET plan = $plan, updated_at = $at WHERE id = $lineId',
        { lineId, plan, at: context.now() }) === 0) {
        throw new StateError('not_found', `没有这条线：${lineId}`);
      }
    },
  };
}

export type LinePlanStore = ReturnType<typeof createLinePlanStore>;
