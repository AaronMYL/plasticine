import { MateHandoff } from './mate-handoff.tsx';
import { useState, type ReactNode } from 'react';
import type { MateGroupView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { LineCard } from '../lines/line-card.tsx';
import { newerLine } from '../lines/line-store.ts';
import { MateAvatar } from './mate-avatar.tsx';
import { MateGroupTaskCard } from './mate-group-task-card.tsx';
import { MateGroupTaskEditor } from './mate-group-task-editor.tsx';

export function MateWorkPanel({ group, phone = false }: { group: MateGroupView; phone?: boolean }): ReactNode {
  const live = useLive();
  const roster = useStore(live.mates.data);
  const list = useStore(live.lines.list);
  const tasks = useStore(live.mates.taskList(group.id));
  const [creating, setCreating] = useState(false);
  const jobs = list.lines.filter((line) => line.kind === 'background' && line.parentLineId === group.lineId
    && !tasks.lines.some((task) => task.id === line.id));
  return <aside className="mate-work-panel" aria-label="群组分工">
    <div className="mate-work-heading"><h3>群组任务</h3><button type="button" className="text-button"
      onClick={() => setCreating(true)}>发布任务</button></div>
    {tasks.error === null ? null : <p className="line-note is-error" role="alert">{tasks.error}
      <button type="button" className="text-button" onClick={() => { void live.mates.reloadTasks(group.id); }}>
        再读一次</button></p>}
    <div className="mate-work-tasks">{tasks.lines.map((task) => <MateGroupTaskCard key={task.id}
      line={newerLine(list.lines.find((item) => item.id === task.id) ?? null, task)} />)}</div>
    <h3>队友分工</h3>
    {group.mateIds.map((id) => {
      const mate = roster.mates.find((candidate) => candidate.id === id);
      if (mate === undefined) return null;
      const assigned = jobs.filter((job) => job.mateId === id);
      return <section key={id}><div className="mate-work-person"><MateAvatar mate={mate} />
        <div><strong>{mate.name}</strong><p>{mate.role}</p></div></div>
        {assigned.map((line) => <div key={line.id}>
          <MateHandoff line={line} /><LineCard line={line} /></div>)}</section>;
    })}
    {creating ? <MateGroupTaskEditor group={group} phone={phone} onClose={() => setCreating(false)} /> : null}
  </aside>;
}
