import type { ReactNode } from 'react';
import type { LineView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { LineCard } from '../lines/line-card.tsx';
import { newerLine } from '../lines/line-store.ts';
import { MateHandoff } from './mate-handoff.tsx';
import { MateGroupTaskCard } from './mate-group-task-card.tsx';

function GroupLineCard({ line, groupId }: { line: LineView; groupId: string }): ReactNode {
  const live = useLive();
  const tasks = useStore(live.mates.taskList(groupId));
  const task = tasks.lines.find((item) => item.id === line.id);
  if (task !== undefined) return <MateGroupTaskCard line={newerLine(line, task)} />;
  if (tasks.status !== 'ready') return <div className="line-card">
    <span>{line.title}</span>{tasks.error === null ? null : <p className="line-note is-error" role="alert">
      {tasks.error}<button type="button" className="text-button"
        onClick={() => { void live.mates.reloadTasks(groupId); }}>再读一次</button></p>}</div>;
  return <OrdinaryLineCard line={line} />;
}

function OrdinaryLineCard({ line }: { line: LineView }): ReactNode {
  return <>{line.mateId == null ? null : <MateHandoff line={line} />}
    <LineCard line={line} stopped={line.outcome === 'stopped'} /></>;
}

export function MateLineCard({ line }: { line: LineView }): ReactNode {
  return line.mateGroupId == null ? <OrdinaryLineCard line={line} />
    : <GroupLineCard line={line} groupId={line.mateGroupId} />;
}
