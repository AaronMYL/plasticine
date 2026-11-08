import { useCallback, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { useLive, useTimeZone } from '../../live.tsx';
import type { ProjectDetail } from '../../api/shared.ts';
import { useStore } from '../../state/use-store.ts';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { HueTile } from '../../shell/hue.tsx';
import { Icon } from '../../shell/icons.tsx';
import type { Route } from '../../shell/routes.ts';
import { WorkStatusGlyph, workStatusText } from '../lines/work-status.tsx';
import { PhoneContent } from '../reading/phone-content.tsx';
import { projectQuote } from '../reading/content-quotes.ts';
import { ProjectTasks } from '../tasks/project-tasks.tsx';
import { useProjectRead } from './use-project-read.ts';
import { briefRows } from './project-brief.ts';
import { dueText, todosOf } from './project-todos.ts';

function Work({ projectId, navigate }: { projectId: string; navigate: (route: Route) => void }): ReactNode {
  const live = useLive();
  const data = useStore(live.lines.list);
  const timeZone = useTimeZone();
  const lines = data.lines.filter((line) => line.projectId === projectId);
  if (lines.length === 0 && data.error === null) return null;
  return <section className="phone-read-section" aria-label="项目工作">
    <h2>工作</h2>
    {data.error === null ? null : <p className="block-empty is-error" role="alert">{data.error}
      <button type="button" className="text-button" onClick={() => void live.lines.loadList()}>重新读取</button>
    </p>}
    <ul className="phone-read-list">{lines.map((line) => <li key={line.id}>
      <button type="button" className="phone-read-row" aria-label={`查看工作：${line.title}`}
        onClick={() => navigate({ view: 'work', noteId: null, lineId: line.id })}>
        <WorkStatusGlyph line={line} />
        <span className="phone-read-row-text">{line.title}<small>{workStatusText(line, timeZone)}</small></span>
        <Icon name="chevron-right" size={14} />
      </button>
    </li>)}</ul>
  </section>;
}

function Body({ detail, navigate }: { detail: ProjectDetail; navigate: (route: Route) => void }): ReactNode {
  const timeZone = useTimeZone();
  const today = new Date().toLocaleDateString('en-CA', { timeZone });
  const todos = todosOf(detail);
  const profile = briefRows(detail.brief, detail.decisions);
  const notes = detail.materials.filter((item) => item.kind === 'note');
  return <>
    {todos.length === 0 ? null : <section className="phone-read-section" aria-label="待办"><h2>待办</h2>
      <ul className="phone-read-list">{todos.map((todo) => <li key={todo.id} className="phone-read-row">
        <StatusGlyph status={todo.doneAt === null ? 'idle' : 'done'} label={todo.doneAt === null ? '待办' : '已完成'} />
        <span className="phone-read-row-text">{todo.title}</span>
        {todo.due === null ? null : <span className="text-meta">{dueText(todo.due, today)}</span>}
      </li>)}</ul>
    </section>}
    <Work projectId={detail.project.id} navigate={navigate} />
    <ProjectTasks projectId={detail.project.id} phone navigate={navigate} head={(title) => <h2>{title}</h2>}
      sectionClass="phone-read-section" />
    {profile.length === 0 ? null : <section className="phone-read-section" aria-label="档案"><h2>档案</h2>
      <dl className="proj-profile">{profile.map((row) => <div key={row.key} className="proj-profile-row">
        <dt>{row.label}</dt><dd>{row.value}</dd>
      </div>)}</dl>
    </section>}
    {notes.length === 0 ? null : <section className="phone-read-section" aria-label="相关笔记"><h2>笔记</h2>
      <ul className="phone-read-list">{notes.map((note) => <li key={note.ref}>
        <button type="button" className="phone-read-row" onClick={() => navigate({ view: 'notes', noteId: note.ref })}>
          <Icon name="notes" size={16} /><span className="phone-read-row-text">{note.title}</span>
          <Icon name="chevron-right" size={14} />
        </button>
      </li>)}</ul>
    </section>}
  </>;
}

export function PhoneProject({ projectId, navigate, onBack }: {
  projectId: string; navigate: (route: Route) => void; onBack?: (() => void) | undefined;
}): ReactNode {
  const api = useApi();
  const timeZone = useTimeZone();
  const read = useCallback((signal: AbortSignal) => api.projects.get(projectId, { tz: timeZone }, signal),
    [api, projectId, timeZone]);
  const { value, error, reload } = useProjectRead(read, projectId);
  const detail = value?.project.id === projectId ? value : null;
  const route: Route = { view: 'projects', noteId: null, projectId };
  return <PhoneContent route={route} navigate={navigate} onBack={onBack} ready={detail !== null}
    quote={detail === null ? null : projectQuote(detail)}>
    <header className="phone-read-title">
      <HueTile hue={detail?.project.hue ?? 'slate'} icon="folder" size={32} />
      <h1>{detail?.project.name ?? '项目'}</h1><span className="tag tag-neutral">只读</span>
    </header>
    {error === null ? null : <p className="block-empty is-error" role="alert">
      {error} <button type="button" className="text-button" onClick={reload}>重新读取</button>
    </p>}
    {detail === null ? error === null ? <p className="block-empty" role="status">正在读取…</p> : null
      : <Body detail={detail} navigate={navigate} />}
  </PhoneContent>;
}
