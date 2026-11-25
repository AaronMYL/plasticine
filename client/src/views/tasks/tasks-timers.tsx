import type { ReactNode } from 'react';
import type { TimerView } from '../../api/shared.ts';
import { useTimeZone } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { nextText } from './task-format.ts';

export interface TasksTimersProps {
  timers: readonly TimerView[];
  now: number;
  busy: string | null;
  failed: { id: string; text: string } | null;
  onStop: (id: string) => void;
}

function metaOf(timer: TimerView): string {
  if (timer.kind === 'wake') {
    return `${timer.lineTitle} · 到点回来看`;
  }
  return timer.lastError === null ? `${timer.lineTitle} · 已看 ${timer.checks} 次` : `上次没看成：${timer.lastError}`;
}

export function TasksTimers({ timers, now, busy, failed, onStop }: TasksTimersProps): ReactNode {
  const openPanel = useOpenPanel();
  const timeZone = useTimeZone();
  if (timers.length === 0) {
    return null;
  }
  return (
    <section className="tasks-section" aria-label="回来看和盯着">
      <h2 className="tasks-section-title">回来看和盯着</h2>
      <ul className="tasks-rows">
        {timers.map((timer) => {
          const error = failed?.id === timer.id ? failed.text : null;
          return (
            <li key={timer.id} className="tasks-row tasks-timer-row" data-kind={timer.kind}>
              <span className="tasks-lead"><Icon name={timer.kind === 'wake' ? 'clock' : 'eye'} size={16} /></span>
              <button type="button" className="tasks-row-main" aria-label={`查看工作：${timer.lineTitle}`}
                onClick={() => openPanel({ kind: 'work', lineId: timer.lineId })}>
                <span className="tasks-row-title">{timer.title}</span>
                <span className="tasks-row-meta" data-error={error !== null || timer.lastError !== null}>
                  {error ?? metaOf(timer)}</span>
              </button>
              <span className="tasks-elapsed">下次 {nextText(timer.nextAt, new Date(now), timeZone)}</span>
              <button type="button" className="secondary-button button-small" disabled={busy === timer.id}
                onClick={() => onStop(timer.id)}>关掉</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
