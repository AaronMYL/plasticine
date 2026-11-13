// 任务栏目「进行中」（11-11 第二步设计稿 T1）：在跑、排队、在等和暂停着的一行一条（状态符 · 标题 + 项目点 · 那一步 /
// 暂停原因 · 已用多久 · 暂停或继续 · ⋯）和队友。Plasticine 自己的例行事（研究员、回顾、心跳、做梦）只在「定时」，
// 跑起来时它那条线照常出现在这里（11-12 第 4 条）。「已结束」「最近删除」两段同一种行。

import { useStore } from '../../state/use-store.ts';
import { mateRoute, routeHash } from '../../shell/routes.ts';
import { MateAvatar } from '../mates/mate-avatar.tsx';
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { LineView, TaskProjectView, TeammateView } from '../../api/shared.ts';
import { useTimeZone } from '../../live.tsx';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { hueVar } from '../../shell/hue.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { useLive } from '../../live.tsx';
import { useNow } from '../lines/line-time.ts';
import { DeletedTask, TaskMenu, taskPhase } from '../lines/task-menu.tsx';
import { unmetText, WorkLineAction, WorkStatusGlyph, workStatusText } from '../lines/work-status.tsx';
import { agoText, runningFor, timedIcon } from './task-format.ts';

function ProjectDot({ project }: { project: TaskProjectView | undefined }): ReactNode {
  if (project === undefined) {
    return null;
  }
  return <span className="tasks-dot" style={{ background: hueVar(project.hue) }} role="img" aria-label={project.name}
    data-tip={project.name} />;
}

function TaskLine({ line, project, now, onDeleted }: { line: LineView; project: TaskProjectView | undefined;
  now: number; onDeleted: (line: LineView) => void }): ReactNode {
  const openPanel = useOpenPanel();
  const timeZone = useTimeZone();
  const [error, setError] = useState<string | null>(null);
  const open = (): void => openPanel({ kind: 'work', lineId: line.id });
  const phase = taskPhase(line);
  const unmet = line.outcome === 'done' ? line.unmet ?? null : null;
  const meta = phase === 'active' ? workStatusText(line, timeZone)
    : phase === 'paused' ? workStatusText(line, timeZone)
      : unmet !== null ? unmetText(unmet) : line.outcome === 'stopped' ? '已停止'
        : line.status === 'failed' ? line.failure ?? '这次没有完成' : line.lastAnswer ?? workStatusText(line, timeZone);
  return (
    <li className="tasks-row tasks-run-row" data-phase={phase} data-context-row="">
      <span className="tasks-lead">
        {line.status === 'running' ? <StatusGlyph status="run" /> : <WorkStatusGlyph line={line} />}
      </span>
      <button type="button" className="tasks-row-main" aria-label={`查看工作：${line.title}`} onClick={open}>
        <span className="tasks-row-title">{line.title}<ProjectDot project={project} /></span>
        <span className="tasks-row-meta" data-error={error !== null || unmet !== null}>{error ?? meta}</span>
      </button>
      <span className="tasks-elapsed">{line.status === 'running' ? runningFor(line.activeSince, now)
        : phase === 'active' ? null : agoText(line.archivedAt ?? line.updatedAt, new Date(now), timeZone)}</span>
      <WorkLineAction line={line} onError={setError} />
      <TaskMenu line={line} onError={setError} onDeleted={onDeleted} />
    </li>
  );
}

/** 一串任务：删掉的那一件就地换成「已删除 · 撤销」。 */
export function TaskLines({ lines, projects, label, now }: { lines: LineView[]; projects: TaskProjectView[];
  label: string; now: number }): ReactNode {
  const [gone, setGone] = useState<ReadonlyMap<string, LineView>>(new Map());
  const projectOf = (id: string | null): TaskProjectView | undefined => projects.find((item) => item.id === id);
  const shown = [...lines.filter((line) => !gone.has(line.id)), ...gone.values()];
  const forget = (id: string): void => setGone((map) => {
    const next = new Map(map);
    next.delete(id);
    return next;
  });
  return (
    <ul className="tasks-rows" aria-label={label}>
      {shown.map((line) => gone.has(line.id)
        ? <li key={line.id}><DeletedTask line={line} onUndone={() => forget(line.id)} /></li>
        : <TaskLine key={line.id} line={line} project={projectOf(line.projectId)} now={now}
          onDeleted={(deleted) => setGone((map) => new Map(map).set(deleted.id, deleted))} />)}
    </ul>
  );
}

export interface TasksRunProps {
  running: LineView[];
  projects: TaskProjectView[];
}

export function TasksRun({ running, projects }: TasksRunProps): ReactNode {
  const now = useNow(running.length > 0);
  const roster = useStore(useLive().mates.data);
  if (running.length === 0 && roster.mates.length === 0) {
    return <p className="tasks-empty">没有在做的事。</p>;
  }
  return (
    <>
      {running.length === 0 ? null : <TaskLines lines={running} projects={projects} label="在做" now={now} />}
      {roster.mates.length === 0 ? null : <section className="tasks-section" aria-label="队友">
        <h2 className="tasks-section-title">队友</h2><ul className="tasks-mates">{roster.mates.map((mate) => (
          <li key={mate.id}><a className="tasks-mate" href={routeHash(mateRoute(mate.id))}>
            <MateAvatar mate={mate} size={32} /><span className="tasks-mate-text">
              <span className="tasks-mate-name">{mate.name}</span><span className="tasks-row-meta">
                {mate.disabledAt === null ? mate.role : '已停用'}</span></span></a></li>
        ))}</ul></section>}
    </>
  );
}
