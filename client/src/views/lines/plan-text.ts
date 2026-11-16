// 线自己列的步骤清单（line_plan，11-16）：做到第几步、进度条多长、任务那一行写什么。

import type { LinePlanStep } from '../../api/shared.ts';

export interface PlanProgress {
  /** 现在在第几步（从 1 数）：在做的那一步；没有在做的，是做完、跳过的步数。 */
  current: number;
  total: number;
  /** 进度条 0–1：做完和跳过的算整步，在做的算半步。 */
  ratio: number;
  /** 在做的那一步（没有就是下一步没做的）。 */
  step: LinePlanStep | null;
}

export function planProgress(plan: readonly LinePlanStep[]): PlanProgress | null {
  if (plan.length === 0) {
    return null;
  }
  const finished = plan.filter((step) => step.status === 'done' || step.status === 'skipped').length;
  const running = plan.findIndex((step) => step.status === 'running');
  const next = plan.find((step) => step.status === 'todo') ?? null;
  return {
    current: running >= 0 ? running + 1 : finished,
    total: plan.length,
    ratio: Math.min(1, (finished + (running >= 0 ? 0.5 : 0)) / plan.length),
    step: running >= 0 ? plan[running] ?? null : next,
  };
}

/** 任务那一行：「第 3 步，共 5 步：打招呼 37 / 200」；没有清单、没有在做的一步是 null（照旧写正在做的事）。 */
export function planText(plan: readonly LinePlanStep[] | null | undefined): string | null {
  const progress = plan == null ? null : planProgress(plan);
  if (progress === null || progress.step?.status !== 'running') {
    return null;
  }
  return `第 ${progress.current} 步，共 ${progress.total} 步：${progress.step.text}`;
}
