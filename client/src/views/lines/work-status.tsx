// 首页、工作详情和对话卡共用执行语义：idle 不等于完成，暂停由原因决定下一步。

import { useState, type ReactNode } from 'react';
import type { LineView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { Icon } from '../../shell/icons.tsx';
import { Spinner } from './line-parts.tsx';
import { activityText, pausedText } from './line-time.ts';

export type WorkExecution = Pick<LineView, 'status' | 'pauseReason' | 'outcome' | 'pausedUntil' | 'failure'>
  & Partial<Pick<LineView, 'activity' | 'queued' | 'archivedAt' | 'unmet'>>;

/** 跑完了但线自己说没做成（line_outcome）：一句原因；做成了、还没跑完、旧记录都是 null。 */
export function unmetReason(line: WorkExecution): string | null {
  return line.status === 'idle' && line.outcome === 'done' && !line.queued ? line.unmet ?? null : null;
}

export function unmetText(reason: string): string {
  return `没做成：${reason}`;
}

export function workStatusText(line: WorkExecution, timeZone?: string): string {
  if (line.archivedAt != null) return '已归档';
  switch (line.status) {
    case 'queued': return '排队中';
    case 'running': return activityText({ activity: line.activity ?? null });
    case 'waiting': return '等你决定';
    case 'paused': return pausedText(line, timeZone);
    case 'failed': return line.failure ?? '这次没有完成';
    case 'idle': return line.queued ? '修改待处理' : line.outcome === 'done'
      ? (line.unmet == null ? '已完成' : unmetText(line.unmet))
      : line.outcome === 'stopped' ? '已停下' : line.outcome === 'incomplete' ? '输出未完' : '待继续';
  }
}

export function WorkStatusGlyph({ line }: { line: WorkExecution }): ReactNode {
  if (line.archivedAt != null) return <StatusGlyph status="pause" label="已归档" />;
  if (line.status === 'running') return <Spinner />;
  if (line.status === 'queued') return <Icon name="clock" size={14} />;
  if (line.status === 'waiting') return <StatusGlyph status="wait" label="等你决定" />;
  if (line.status === 'failed' || line.outcome === 'failed') return <StatusGlyph status="err" label="出错" />;
  if (line.status === 'idle' && line.outcome === 'done' && !line.queued) {
    return line.unmet == null ? <StatusGlyph status="done" label="已完成" />
      : <StatusGlyph status="err" label="没做成" />;
  }
  return <StatusGlyph status="pause" label="暂停" />;
}

/** 只控制执行；联系人任务的「我来处理」另走真实的接手接口，不能复用暂停。 */
export function WorkLineAction({ line, onError, primary = false }:
  { line: LineView; onError: (error: string | null) => void; primary?: boolean }): ReactNode {
  const live = useLive();
  const [busy, setBusy] = useState(false);
  const pause = line.status === 'running' || line.status === 'queued' || line.status === 'waiting';
  const canRetry = line.status === 'failed' || line.status === 'paused' || line.outcome === 'incomplete';
  if (line.archivedAt != null || (!pause && !canRetry)) return null;
  const label = pause ? '暂停' : line.pauseReason === 'output_limit' ? '继续生成'
    : line.status === 'failed' ? '重试' : line.pauseReason === 'quota' ? '现在重试' : '继续';
  const run = (): void => {
    setBusy(true);
    onError(null);
    void (pause ? live.lines.stopLine(line.id) : live.lines.retry(line.id)).then((error) => {
      setBusy(false);
      onError(error);
    });
  };
  return <button type="button" className={`${primary && !pause ? 'primary-button' : 'secondary-button'} button-small`}
    disabled={busy} onClick={run}>{label}</button>;
}
