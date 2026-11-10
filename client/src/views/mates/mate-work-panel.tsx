import { MateHandoff } from './mate-handoff.tsx';
import type { ReactNode } from 'react';
import type { MateGroupView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { LineCard } from '../lines/line-card.tsx';
import { MateAvatar } from './mate-avatar.tsx';

export function MateWorkPanel({ group }: { group: MateGroupView }): ReactNode {
  const live = useLive();
  const roster = useStore(live.mates.data);
  const list = useStore(live.lines.list);
  const jobs = list.lines.filter((line) => line.kind === 'background' && line.parentLineId === group.lineId);
  return <aside className="mate-work-panel" aria-label="群组分工"><h3>队友分工</h3>
    {group.mateIds.map((id) => {
      const mate = roster.mates.find((candidate) => candidate.id === id);
      if (mate === undefined) return null;
      const assigned = jobs.filter((job) => job.mateId === id);
      return <section key={id}><div className="mate-work-person"><MateAvatar mate={mate} />
        <div><strong>{mate.name}</strong><p>{mate.role}</p></div></div>
        {assigned.map((line) => <div key={line.id}>
          <MateHandoff line={line} /><LineCard line={line} /></div>)}</section>;
    })}
  </aside>;
}
