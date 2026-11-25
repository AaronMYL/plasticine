import { useState, type ReactNode } from 'react';
import type { TimedRowView } from '../../api/shared.ts';
import type { Route } from '../../shell/routes.ts';
import { TasksIdeas } from './tasks-ideas.tsx';
import { TasksTimed } from './tasks-timed.tsx';
import { TimedSheet } from './timed-sheet.tsx';
import { useTaskActions, useTasksBoard } from './use-tasks-board.ts';
import './tasks.css';

export function ProjectTasks({ projectId, phone, navigate, head, sectionClass = 'tasks-project' }: {
  projectId: string; phone: boolean; navigate: (route: Route) => void; head: (title: string) => ReactNode;
  sectionClass?: string;
}): ReactNode {
  const { board, reload } = useTasksBoard(projectId);
  const actions = useTaskActions(reload);
  const [open, setOpen] = useState<string | null>(null);
  if (board === null) {
    return null;
  }
  const row = board.timed.find((item) => item.id === open) ?? null;
  return (
    <>
      {board.timed.length === 0 ? null : (
        <section aria-label="这个项目的定时" className={sectionClass}>
          {head('定时')}
          <TasksTimed rows={board.timed} actions={actions} phone open={(item: TimedRowView) => setOpen(item.id)}
            navigate={navigate} />
        </section>
      )}
      {board.ideas.length === 0 ? null : (
        <section aria-label="这个项目的建议" className={sectionClass}>
          {head('建议')}
          <TasksIdeas ideas={board.ideas} actions={actions} />
        </section>
      )}
      <TimedSheet open={row === null ? null : { kind: 'row', row }} actions={actions} phone={phone}
        close={() => setOpen(null)} />
    </>
  );
}
