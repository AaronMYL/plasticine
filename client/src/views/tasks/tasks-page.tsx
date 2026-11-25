import { useState, type ReactNode } from 'react';
import { PROACTIVE_DOC_ID, type TasksBoardResponse, type TimedRowView } from '../../api/shared.ts';
import { PageHeader } from '../../shell/page-header.tsx';
import { routeHash, TASKS_SECTIONS, type Route, type TasksSection } from '../../shell/routes.ts';
import { AskPlaceProvider } from '../asks/ask-context.tsx';
import { useAskOrigin } from '../asks/ask-labels.ts';
import { LineAskCard } from '../asks/line-ask-card.tsx';
import { TasksIdeas } from './tasks-ideas.tsx';
import { TaskLines, TasksRun } from './tasks-run.tsx';
import { TasksTimed } from './tasks-timed.tsx';
import { TasksTimers } from './tasks-timers.tsx';
import { TimedSheet, type OpenSheet } from './timed-sheet.tsx';
import { useTaskActions, useTasksBoard } from './use-tasks-board.ts';
import './tasks.css';

export const SECTION_TITLES: Readonly<Record<TasksSection, string>> = {
  run: '在做',
  wait: '等你',
  timed: '定时',
  ideas: '建议',
  ended: '已结束',
  deleted: '最近删除',
};

const COUNT_KEYS = { run: 'running', wait: 'waiting', timed: 'timed', ideas: 'ideas', ended: 'ended',
  deleted: 'deleted' } as const;
const COUNTED: ReadonlySet<TasksSection> = new Set(['run', 'wait', 'timed', 'ideas']);

export interface TasksPageProps {
  section: TasksSection;
  phone: boolean;
  navigate: (route: Route) => void;
}

function Sections({ section, counts, navigate }: { section: TasksSection;
  counts: Record<(typeof COUNT_KEYS)[TasksSection], number> | null; navigate: (route: Route) => void }): ReactNode {
  return (
    <div className="segmented tasks-segmented" role="group" aria-label="任务">
      {TASKS_SECTIONS.map((item) => (
        <a key={item} className="segmented-item" href={routeHash({ view: 'tasks', noteId: null, tasksSection: item })}
          aria-current={item === section ? 'page' : undefined} onClick={(event) => {
            event.preventDefault();
            navigate({ view: 'tasks', noteId: null, tasksSection: item });
          }}>
          {SECTION_TITLES[item]}
          {counts === null || !COUNTED.has(item) || counts[COUNT_KEYS[item]] === 0 ? null
            : <span className="seg-count">{counts[COUNT_KEYS[item]]}</span>}
        </a>
      ))}
    </div>
  );
}

function currentSheet(sheet: OpenSheet | null, board: TasksBoardResponse | null): OpenSheet | null {
  if (sheet === null || board === null) {
    return sheet;
  }
  if (sheet.kind === 'row') {
    const row = board.timed.find((item) => item.id === sheet.row.id);
    return row === undefined ? null : { kind: 'row', row };
  }
  const mate = board.teammates.find((item) => item.id === sheet.mate.id) ?? sheet.mate;
  return { kind: 'mate', mate, rows: board.timed.filter((row) => mate.rowIds.includes(row.id)) };
}

const WAIT_PLACE = { kind: 'wait' } as const;

export function TasksPage({ section, phone, navigate }: TasksPageProps): ReactNode {
  const { board, error, reload } = useTasksBoard(null);
  const actions = useTaskActions(reload);
  const origin = useAskOrigin();
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const current = currentSheet(sheet, board);
  const openRow = (row: TimedRowView): void => (row.source === 'heartbeat'
    ? navigate({ view: 'memory', noteId: null, topicId: PROACTIVE_DOC_ID }) : setSheet({ kind: 'row', row }));
  return (
    <div className="page tasks-main" data-section={section}>
      {phone ? (
        <PageHeader title="任务" phoneSearch={false}
          controls={<Sections section={section} counts={board?.counts ?? null} navigate={navigate} />} />
      ) : <h1 className="tasks-title">{SECTION_TITLES[section]}</h1>}
      {error === null ? null : <p className="tasks-error" role="alert">{error}
        <button type="button" className="text-button" onClick={reload}>再读一次</button></p>}
      {board === null ? null : (
        <div className="tasks-body">
          {section === 'run' ? <>
            <TasksRun running={board.running} projects={board.projects} hasTimers={(board.timers ?? []).length > 0} />
            <TasksTimers timers={board.timers ?? []} now={Date.now()} busy={actions.busy} failed={actions.failed}
              onStop={(id) => void actions.stopTimer(id)} />
          </> : null}
          {section === 'ended' ? (board.ended.length === 0 ? <p className="tasks-empty">还没有结束的事。</p>
            : <TaskLines lines={board.ended} projects={board.projects} label="已结束" now={Date.now()} />) : null}
          {section === 'deleted' ? (board.deleted.length === 0 ? <p className="tasks-empty">最近没有删除的事。</p>
            : <TaskLines lines={board.deleted} projects={board.projects} label="最近删除" now={Date.now()} />) : null}
          {section === 'wait' ? (board.waiting.length === 0 ? <p className="tasks-empty">没有等你的事。</p> : (
            <AskPlaceProvider place={WAIT_PLACE} source={origin}>
              <div className="tasks-waiting">{board.waiting.map((ask) => <LineAskCard key={ask.id} ask={ask} />)}</div>
            </AskPlaceProvider>
          )) : null}
          {section === 'timed' ? <TasksTimed rows={board.timed} actions={actions} phone={phone} open={openRow}
            navigate={navigate} /> : null}
          {section === 'ideas' ? <TasksIdeas ideas={board.ideas} actions={actions} /> : null}
        </div>
      )}
      <TimedSheet open={current} actions={actions} phone={phone} close={() => setSheet(null)} />
    </div>
  );
}
