import type { LinePlanStep } from '../../api/shared.ts';

export interface PlanProgress {
  current: number;
  total: number;
  ratio: number;
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

export function planText(plan: readonly LinePlanStep[] | null | undefined): string | null {
  const progress = plan == null ? null : planProgress(plan);
  if (progress === null || progress.step?.status !== 'running') {
    return null;
  }
  return `第 ${progress.current} 步，共 ${progress.total} 步：${progress.step.text}`;
}
