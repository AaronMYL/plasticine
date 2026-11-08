// 任务栏目「在做」（设计稿 Tasks-Run）：正在跑的线一行一条（动态符号 · 标题 + 项目点 · 在做的那一步 · 已用多久 · 停 · ›）；
// 队友（第 5 条：每件长期的事一个看得见的执行者，点开看它管什么、能叫停）；刚做完（做成 / 没做成 + 原因）。

import type { CSSProperties, ReactNode } from 'react';
import type { LineView, TaskProjectView, TeammateView } from '../../api/shared.ts';
import { useTimeZone } from '../../live.tsx';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { hueVar } from '../../shell/hue.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { useLive } from '../../live.tsx';
import { useNow } from '../lines/line-time.ts';
import { unmetText, WorkStatusGlyph } from '../lines/work-status.tsx';
import { agoText, runningFor, timedIcon } from './task-format.ts';

function ProjectDot({ project }: { project: TaskProjectView | undefined }): ReactNode {
  if (project === undefined) {
    return null;
  }
  return <span className="tasks-dot" style={{ background: hueVar(project.hue) }} role="img" aria-label={project.name}
    data-tip={project.name} />;
}

function RunRow({ line, project, now }: { line: LineView; project: TaskProjectView | undefined; now: number })
  : ReactNode {
  const live = useLive();
  const openPanel = useOpenPanel();
  const open = (): void => openPanel({ kind: 'work', lineId: line.id });
  return (
    <li className="tasks-row tasks-run-row">
      <span className="tasks-lead">
        {line.status === 'running' ? <StatusGlyph status="run" /> : <WorkStatusGlyph line={line} />}
      </span>
      <button type="button" className="tasks-row-main" aria-label={`查看工作：${line.title}`} onClick={open}>
        <span className="tasks-row-title">{line.title}<ProjectDot project={project} /></span>
        <span className="tasks-row-meta">{line.activity ?? (line.status === 'queued' ? '排队中' : '在想…')}</span>
      </button>
      <span className="tasks-elapsed">{line.status === 'running' ? runningFor(line.activeSince, now) : null}</span>
      <IconButton icon="stop" label={`停下：${line.title}`} size={14}
        onClick={() => void live.lines.stopLine(line.id)} />
      <button type="button" className="tasks-chevron" aria-hidden="true" tabIndex={-1} onClick={open}>
        <Icon name="chevron-right" size={14} />
      </button>
    </li>
  );
}

function Mate({ mate, onOpen }: { mate: TeammateView; onOpen: (mate: TeammateView) => void }): ReactNode {
  return (
    <li>
      <button type="button" className="tasks-mate" aria-label={`队友：${mate.name}`} onClick={() => onOpen(mate)}>
        <span className="tasks-mate-face" style={{ '--tile-hue': hueVar(mate.hue) } as CSSProperties}
          aria-hidden="true"><Icon name={timedIcon(mate.icon)} size={17} /></span>
        <span className="tasks-mate-text">
          <span className="tasks-mate-name"><StatusGlyph status={mate.glyph} />{mate.name}</span>
          <span className="tasks-row-meta">{mate.now}</span>
        </span>
      </button>
    </li>
  );
}

function RecentRow({ line, now }: { line: LineView; now: Date }): ReactNode {
  const openPanel = useOpenPanel();
  const timeZone = useTimeZone();
  const unmet = line.outcome === 'done' ? line.unmet ?? null : null;
  const failed = line.outcome === 'failed' || line.status === 'failed';
  const note = unmet !== null ? unmetText(unmet) : failed ? line.failure ?? '这次没有完成' : line.lastAnswer;
  return (
    <li className="tasks-row tasks-recent-row">
      <span className="tasks-lead"><WorkStatusGlyph line={line} /></span>
      <button type="button" className="tasks-row-main tasks-row-inline" aria-label={`查看工作：${line.title}`}
        onClick={() => openPanel({ kind: 'work', lineId: line.id })}>
        <span className="tasks-row-title">{line.title}</span>
        {note === null ? null : (
          <span className="tasks-row-note" data-error={unmet !== null || failed}>{note}</span>
        )}
      </button>
      <span className="tasks-when">{agoText(line.updatedAt, now, timeZone)}</span>
      <Icon name="chevron-right" size={14} />
    </li>
  );
}

export interface TasksRunProps {
  running: LineView[];
  recent: LineView[];
  teammates: TeammateView[];
  projects: TaskProjectView[];
  onMate: (mate: TeammateView) => void;
}

export function TasksRun({ running, recent, teammates, projects, onMate }: TasksRunProps): ReactNode {
  const now = useNow(running.length > 0);
  const projectOf = (id: string | null): TaskProjectView | undefined => projects.find((item) => item.id === id);
  if (running.length === 0 && recent.length === 0 && teammates.length === 0) {
    return <p className="tasks-empty">没有在做的事。</p>;
  }
  return (
    <>
      {running.length === 0 ? null : (
        <ul className="tasks-rows" aria-label="在做">
          {running.map((line) => <RunRow key={line.id} line={line} project={projectOf(line.projectId)} now={now} />)}
        </ul>
      )}
      {teammates.length === 0 ? null : (
        <section className="tasks-section" aria-label="队友">
          <h2 className="tasks-section-title">队友</h2>
          <ul className="tasks-mates">{teammates.map((mate) => <Mate key={mate.id} mate={mate} onOpen={onMate} />)}</ul>
        </section>
      )}
      {recent.length === 0 ? null : (
        <section className="tasks-section" aria-label="刚做完">
          <h2 className="tasks-section-title">刚做完</h2>
          <ul className="tasks-rows">
            {recent.map((line) => <RecentRow key={line.id} line={line} now={new Date(now)} />)}
          </ul>
        </section>
      )}
    </>
  );
}
