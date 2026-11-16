// 工作详情最上面的步骤清单（11-16 设计稿）：标题「步骤」和「3 / 5」，一根 4px 的细进度条（进行中的蓝），下面一步一行：
// 做完的勾、在做的点、没做的空心圈、跳过的划掉。超过 8 步时做完的收成「已做 n 步」一行，点开全看。

import { useState, type ReactNode } from 'react';
import type { LinePlanStep } from '../../api/shared.ts';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { planProgress } from './plan-text.ts';

const FOLD_OVER = 8;

function StepGlyph({ step }: { step: LinePlanStep }): ReactNode {
  switch (step.status) {
    case 'done': return <StatusGlyph status="done" />;
    case 'running': return <StatusGlyph status="run" />;
    case 'skipped': return <StatusGlyph status="idle" label="跳过了" />;
    case 'todo': return <StatusGlyph status="idle" />;
  }
}

export function WorkPlan({ plan }: { plan: readonly LinePlanStep[] | null | undefined }): ReactNode {
  const [open, setOpen] = useState(false);
  const progress = plan == null ? null : planProgress(plan);
  if (plan == null || progress === null) {
    return null;
  }
  const finished = plan.filter((step) => step.status === 'done' || step.status === 'skipped').length;
  const fold = !open && plan.length > FOLD_OVER && finished > 0;
  const shown = fold ? plan.filter((step) => step.status !== 'done' && step.status !== 'skipped') : plan;
  return (
    <section className="work-plan" aria-label="步骤">
      <div className="work-plan-head">
        <h3>步骤</h3><span className="work-plan-count">{progress.current} / {progress.total}</span>
      </div>
      <div className="work-plan-bar" role="progressbar" aria-label="做到哪了" aria-valuemin={0}
        aria-valuemax={progress.total} aria-valuenow={progress.current}>
        <i style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
      </div>
      <ol className="work-plan-steps">
        {fold ? <li className="work-plan-step" data-status="done">
          <StatusGlyph status="done" />
          <button type="button" className="text-button" onClick={() => setOpen(true)}>已做 {finished} 步</button>
        </li> : null}
        {shown.map((step, index) => (
          <li key={`${index}:${step.text}`} className="work-plan-step" data-status={step.status}>
            <StepGlyph step={step} /><span>{step.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
