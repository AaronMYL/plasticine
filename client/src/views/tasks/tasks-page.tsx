// 任务栏目的主区（《优化清单》第 3、4、5 条，设计稿 Tasks-Run / Tasks-Timed / Tasks-Ideas，手机 Phone-Tasks）：
// #/tasks 在做、#/tasks/wait 等你、#/tasks/timed 定时、#/tasks/ideas 建议。第二栏（四段 + 项目，带个数）是侧栏重做那一段，
// 电脑上先只画主区；手机照稿子在标题下放分段控件。等你就是那几张要你定卡本身，在这里就地答。

import { useState, type ReactNode } from 'react';
import type { TasksBoardResponse, TeammateView, TimedRowView } from '../../api/shared.ts';
import { PageHeader } from '../../shell/page-header.tsx';
import { routeHash, TASKS_SECTIONS, type Route, type TasksSection } from '../../shell/routes.ts';
import { LineAskCard } from '../asks/line-ask-card.tsx';
import { registerHeartbeatSheet } from './heartbeat-sheet.tsx';
import { TasksIdeas } from './tasks-ideas.tsx';
import { TasksRun } from './tasks-run.tsx';
import { TasksTimed } from './tasks-timed.tsx';
import { TimedSheet, type OpenSheet } from './timed-sheet.tsx';
import { useTaskActions, useTasksBoard } from './use-tasks-board.ts';
import './tasks.css';

// 「定时」里点开心跳那一行：心跳自己的弹层（第 11 条）。
registerHeartbeatSheet();

export const SECTION_TITLES: Readonly<Record<TasksSection, string>> = {
  run: '在做',
  wait: '等你',
  timed: '定时',
  ideas: '建议',
};

const COUNT_KEYS = { run: 'running', wait: 'waiting', timed: 'timed', ideas: 'ideas' } as const;

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
          {counts === null || counts[COUNT_KEYS[item]] === 0 ? null
            : <span className="seg-count">{counts[COUNT_KEYS[item]]}</span>}
        </a>
      ))}
    </div>
  );
}

/** 弹层开着时，按最新读到的那一份画（开关拨了、队友叫停了跟着变）；那一行没了就收起。 */
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

export function TasksPage({ section, phone, navigate }: TasksPageProps): ReactNode {
  const { board, error, reload } = useTasksBoard(null);
  const actions = useTaskActions(reload);
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const current = currentSheet(sheet, board);
  const openRow = (row: TimedRowView): void => setSheet({ kind: 'row', row });
  const openMate = (mate: TeammateView): void => setSheet({ kind: 'mate', mate, rows: [] });
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
          {section === 'run' ? <TasksRun running={board.running} recent={board.recent} teammates={board.teammates}
            projects={board.projects} onMate={openMate} /> : null}
          {section === 'wait' ? (board.waiting.length === 0 ? <p className="tasks-empty">没有等你的事。</p> : (
            <div className="tasks-waiting">{board.waiting.map((ask) => <LineAskCard key={ask.id} ask={ask} />)}</div>
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
