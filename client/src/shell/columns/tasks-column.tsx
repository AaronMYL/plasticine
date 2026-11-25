import type { ReactNode } from 'react';
import type { TaskCounts } from '../../api/shared.ts';
import { useTasksBoard } from '../../views/tasks/use-tasks-board.ts';
import { StatusGlyph } from '../glyph.tsx';
import { hueVar } from '../hue.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { TASKS_SECTIONS, type Route, type TasksSection } from '../routes.ts';
import { ColumnCount, ColumnFoot, ColumnHead, ColumnLabel, ColumnLink, ColumnNote } from './column.tsx';

const ROWS: Readonly<Record<TasksSection, { label: string; count: keyof TaskCounts; lead: 'run' | 'wait' | IconName }>>
  = {
    run: { label: '在做', count: 'running', lead: 'run' },
    wait: { label: '等你', count: 'waiting', lead: 'wait' },
    timed: { label: '定时', count: 'timed', lead: 'clock' },
    ideas: { label: '建议', count: 'ideas', lead: 'bulb' },
    ended: { label: '已结束', count: 'ended', lead: 'check' },
    deleted: { label: '最近删除', count: 'deleted', lead: 'trash' },
  };
const MAIN_SECTIONS = TASKS_SECTIONS.filter((item) => item !== 'deleted');

function Lead({ lead }: { lead: 'run' | 'wait' | IconName }): ReactNode {
  if (lead === 'run' || lead === 'wait') {
    return <StatusGlyph status={lead} />;
  }
  return <Icon name={lead} size={16} />;
}

export function TasksColumn({ route, navigate }: { route: Route; navigate: (route: Route) => void }): ReactNode {
  const { board, error } = useTasksBoard(null);
  const section = route.view === 'tasks' ? route.tasksSection ?? 'run' : null;
  const projectId = route.view === 'projects' ? route.projectId ?? null : null;
  return (
    <>
      <ColumnHead title="任务" />
      <div className="column-scroll">
        {MAIN_SECTIONS.map((item) => (
          <ColumnLink key={item} route={{ view: 'tasks', noteId: null, tasksSection: item }}
            current={section === item} navigate={navigate} lead={<Lead lead={ROWS[item].lead} />}
            trail={item === 'ended' ? null : <ColumnCount value={board?.counts[ROWS[item].count] ?? null} />}>
            {ROWS[item].label}
          </ColumnLink>
        ))}
        {error === null ? null : <ColumnNote>{error}</ColumnNote>}
        {board === null || board.projects.length === 0 ? null : <>
          <ColumnLabel>项目</ColumnLabel>
          {board.projects.map((project) => (
            <ColumnLink key={project.id} route={{ view: 'projects', noteId: null, projectId: project.id }}
              current={projectId === project.id} navigate={navigate}
              lead={<span className="column-dot" style={{ background: hueVar(project.hue) }} aria-hidden="true" />}>
              {project.name}
            </ColumnLink>
          ))}
        </>}
      </div>
      <ColumnFoot>
        <ColumnLink route={{ view: 'tasks', noteId: null, tasksSection: 'deleted' }} current={section === 'deleted'}
          navigate={navigate} lead={<Icon name="trash" size={16} />}
          trail={<ColumnCount value={board?.counts.deleted ?? null} />}>最近删除</ColumnLink>
      </ColumnFoot>
    </>
  );
}
