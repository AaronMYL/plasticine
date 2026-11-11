// 后台线在对话里的卡（2026-11-05 设计稿 Steps，11-07 第 17 条改）：在做 = 动态符号 · 标题 · 停止，下面一行实时状态；
// 做完 = 勾 · 标题 ·「做了 n 步 ›」；跑完了但线说没做成 = 叉 + 一行红字原因（走查 11-07）（点开才读那条线的步骤），结果（普通文字）贴在卡下面；
// 等你 = 陶土橙点 + 「等你定」；暂停 = 两竖 + 几点接着做；出错 = 红叉 + 原因 + 重试；被叫停 = 两竖 + 「停下了」。

import { useId, useMemo, useState, type ReactNode } from 'react';
import type { LineView } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { useStore } from '../../state/use-store.ts';
import { Icon } from '../../shell/icons.tsx';
import { StepList } from './line-parts.tsx';
import { DeletedTask, TaskMenu } from './task-menu.tsx';
import { unmetReason, unmetText, WorkLineAction, WorkStatusGlyph, workStatusText } from './work-status.tsx';
import { buildTimeline, type TurnStep } from './timeline.ts';

/** 做完的线的步骤（读那条线；做完的卡不多，打开就读）。 */
function useDoneSteps(lineId: string): { steps: TurnStep[]; error: string | null } {
  const live = useLive();
  const data = useStore(live.lines.thread(lineId));
  const steps = useMemo<TurnStep[]>(() => buildTimeline({ lineId, messages: data.messages, lines: [],
    summaries: data.summaries }).flatMap((item) => (item.kind === 'turn' ? item.steps : [])), [data, lineId]);
  return { steps, error: data.error };
}

function DoneFold({ lineId, open, listId, onToggle }: { lineId: string; open: boolean; listId: string;
  onToggle: () => void }): ReactNode {
  const { steps, error } = useDoneSteps(lineId);
  if (error !== null) {
    return <span className="line-card-note is-error" role="alert">{error}</span>;
  }
  return steps.length === 0 ? null : (
    <button type="button" className="line-card-steps" aria-expanded={open} aria-controls={listId} onClick={onToggle}>
      做了 {steps.length} 步<Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
    </button>
  );
}

function DoneList({ lineId, listId }: { lineId: string; listId: string }): ReactNode {
  const { steps } = useDoneSteps(lineId);
  return <div className="line-card-fold"><StepList id={listId} steps={steps} /></div>;
}

/**
 * 子代理在对话里的卡（《优化清单》第 17 条，11-07 设计稿）：做完 = 勾 · 标题 ·「做了 n 步 ›」（点开才看步骤，
 * 子代理的工具调用和日志不进对话正文）；在做 = 动态符号 · 标题 · 停下，下面一行实时状态。
 */
export function LineCard({ line, result, stopped = false }: { line: LineView; result?: ReactNode;
  stopped?: boolean }): ReactNode {
  const open = useOpenPanel();
  const timeZone = useTimeZone();
  const [error, setError] = useState<string | null>(null);
  const [folded, setFolded] = useState(true);
  const listId = useId();
  const done = line.status === 'idle' && line.outcome === 'done' && line.queued === 0 && !stopped;
  const unmet = unmetReason(line);
  const second = stopped ? '停下了' : done ? null : workStatusText(line, timeZone);
  const [deleted, setDeleted] = useState(false);
  if (line.archivedAt != null) {
    return deleted ? <DeletedTask line={line} onUndone={() => setDeleted(false)} /> : null;
  }
  return (
    <div className="line-card-wrap">
      <article className="line-card" data-status={line.status} aria-label={`线：${line.title}`}>
        <div className="line-card-head">
          <span className="line-card-lead"><WorkStatusGlyph line={line} /></span>
          <button type="button" className="line-card-title nt-work-link" aria-label={`查看工作：${line.title}`}
            onClick={() => open({ kind: 'work', lineId: line.id })}>{line.title}</button>
          {done ? <DoneFold lineId={line.id} open={!folded} listId={listId}
            onToggle={() => setFolded((value) => !value)} /> : null}
          <WorkLineAction line={line} onError={setError} />
          <TaskMenu line={line} onError={setError} onDeleted={() => setDeleted(true)} />
        </div>
        {unmet === null || stopped ? null
          : <p className="line-card-status" data-status="unmet">{unmetText(unmet)}</p>}
        {second === null ? null : <p className="line-card-status" data-status={line.status}>{second}</p>}
        {done && !folded ? <DoneList lineId={line.id} listId={listId} /> : null}
        {error === null ? null : <p className="line-card-note is-error" role="alert">{error}</p>}
      </article>
      {result}
    </div>
  );
}
