// 一个项目（2026-11-05 设计稿 Project）：顶上项目色点 + 名字 + 改档案 · ⋯；左栏 待办（带期限，原来的关切并进来）和这个项目的
// 线（在跑的一行实时状态、能停；做完的勾 + 结果一句 + 日子）；右栏 档案（一行一条）和相关笔记。

import { useCallback, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { ProjectDetail, ProjectTodoView } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { hueVar } from '../../shell/hue.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import type { Route } from '../../shell/routes.ts';
import { useStore } from '../../state/use-store.ts';
import { DoingRow } from '../home/home-now.tsx';
import { useNow } from '../lines/line-time.ts';
import { BriefForm, ProjectEditForm } from './project-edit.tsx';
import { briefRows } from './project-brief.ts';
import { addTodo, dueText, setTodoDone, todosOf } from './project-todos.ts';
import { useProjectRead } from './use-project-read.ts';
import './project-detail.css';
import { ProjectTasks } from '../tasks/project-tasks.tsx';
import { PageLoading } from '../../primitives/page-loading/index.tsx';

function Head({ title, tail }: { title: string; tail?: ReactNode }): ReactNode {
  return (
    <h2 className="proj-head">
      {title}{tail === undefined ? null : <><span className="proj-head-gap" />{tail}</>}
    </h2>
  );
}

function TodoRow({ projectId, todo, today, onDone }: { projectId: string; todo: ProjectTodoView; today: string;
  onDone: () => void }): ReactNode {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = todo.doneAt !== null;
  const soon = !done && todo.due !== null && dueText(todo.due, today) !== todo.due.slice(5);
  const late = !done && todo.dueInDays !== null && todo.dueInDays < 0;
  return (
    <li className="proj-row" data-done={done}>
      <input type="checkbox" className="proj-check-input" aria-label={`做完了：${todo.title}`} checked={done}
        disabled={busy} onChange={() => {
          setBusy(true);
          setTodoDone(api, projectId, todo, !done).then(() => {
            setBusy(false);
            onDone();
          }, (cause: unknown) => {
            setBusy(false);
            setError(errorText(cause));
          });
        }} />
      <span className="proj-row-title">{todo.title}</span>
      {error === null ? null : <span className="proj-row-error" role="alert">{error}</span>}
      {todo.due === null ? null : (
        <span className="proj-due" data-soon={soon} data-late={late}>{dueText(todo.due, today)}</span>
      )}
    </li>
  );
}

function AddTodo({ projectId, onDone, onCancel }: { projectId: string; onDone: () => void; onCancel: () => void })
  : ReactNode {
  const api = useApi();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (title.trim() === '') return;
    addTodo(api, projectId, title.trim(), due === '' ? null : due)
      .then(onDone, (cause: unknown) => setError(errorText(cause)));
  };
  return (
    <form className="proj-row proj-add" onSubmit={submit}>
      <span className="proj-check-input" aria-hidden="true" />
      <input className="proj-add-input" autoFocus aria-label="待办" placeholder="加一条待办" value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }} />
      <input type="date" className="proj-add-due" aria-label="期限" value={due}
        onChange={(event) => setDue(event.target.value)} />
      <button type="submit" className="sr-only">加上</button>
      {error === null ? null : <span className="proj-row-error" role="alert">{error}</span>}
    </form>
  );
}

function Todos({ detail, onChanged }: { detail: ProjectDetail; onChanged: () => void }): ReactNode {
  const timeZone = useTimeZone();
  const [adding, setAdding] = useState(false);
  const todos = todosOf(detail);
  const today = new Date().toLocaleDateString('en-CA', { timeZone });
  return (
    <section aria-label="待办">
      <Head title="待办" tail={<IconButton icon="plus" label="加一条待办" onClick={() => setAdding(true)} />} />
      <ul className="proj-list">
        {todos.map((todo) => <TodoRow key={todo.id} projectId={detail.project.id} todo={todo} today={today}
          onDone={onChanged} />)}
        {adding ? <li><AddTodo projectId={detail.project.id} onCancel={() => setAdding(false)} onDone={() => {
          setAdding(false);
          onChanged();
        }} /></li> : null}
      </ul>
    </section>
  );
}

function Lines({ projectId }: { projectId: string }): ReactNode {
  const live = useLive();
  const list = useStore(live.lines.list);
  const lines = list.lines.filter((line) => line.projectId === projectId);
  const now = useNow(lines.some((line) => line.status === 'running'));
  if (lines.length === 0) {
    return null;
  }
  return (
    <section aria-label="这个项目的线">
      <Head title="工作线" />
      <ul className="proj-list">
        {lines.map((line) => <DoingRow key={line.id} line={line} phone={false} now={now} />)}
      </ul>
    </section>
  );
}

function Profile({ detail, editing, onEdit, onDone }: { detail: ProjectDetail; editing: boolean; onEdit: () => void;
  onDone: () => void }): ReactNode {
  const rows = briefRows(detail.brief, detail.decisions);
  if (editing) {
    return (
      <section aria-label="档案">
        <Head title="档案" />
        <BriefForm row={detail.project} brief={detail.brief} onDone={onDone} onCancel={onDone} />
      </section>
    );
  }
  return (
    <section aria-label="档案">
      <Head title="档案" />
      {rows.length === 0 ? (
        <button type="button" className="text-button text-button-quiet" onClick={onEdit}>写档案</button>
      ) : (
        <dl className="proj-profile">
          {rows.map((row) => (
            <div key={row.key} className="proj-profile-row">
              <dt>{row.label}</dt>
              <dd>{row.value}{row.quoteRef === undefined ? null : (
                <a className="proj-quote-link" href={`#/conversation/${encodeURIComponent(row.quoteRef)}`}
                  aria-label={`原话：${row.value}`}>原话</a>
              )}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function Notes({ detail, navigate }: { detail: ProjectDetail; navigate: (route: Route) => void }): ReactNode {
  const notes = detail.materials.filter((item) => item.kind === 'note');
  if (notes.length === 0) {
    return null;
  }
  return (
    <section aria-label="相关笔记">
      <Head title="笔记" />
      <ul className="proj-list">
        {notes.map((item) => (
          <li key={item.ref}>
            <button type="button" className="proj-row proj-note" onClick={() => navigate({ view: 'notes',
              noteId: item.ref })}>
              <Icon name="notes" size={14} />
              <span className="proj-row-title">{item.title}</span>
              {item.at === null ? null : <span className="proj-date">{item.at.slice(5, 10)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Editing = 'project' | 'brief' | null;

function Body({ detail, reload, navigate }: {
  detail: ProjectDetail; reload: () => void; navigate: (route: Route) => void;
}): ReactNode {
  const [editing, setEditing] = useState<Editing>(null);
  const { project: row } = detail;
  const done = (): void => {
    setEditing(null);
    reload();
  };
  return (
    <div className="page proj-page proj-detail" style={{ '--dot-hue': hueVar(row.hue) } as CSSProperties}>
      <header className="proj-title-row">
        <span className="proj-hue-dot" aria-hidden="true" />
        <h1 className="proj-title">{row.name}</h1>
        <IconButton icon="edit" label="改档案" onClick={() => setEditing('brief')} />
        <RevealMore label={`「${row.name}」的更多操作`} actions={[
          { icon: 'edit', label: '改名字和状态', onSelect: () => setEditing('project') },
          { icon: 'folder', label: '全部项目', onSelect: () => navigate({ view: 'projects', noteId: null }) },
        ]} />
      </header>
      {editing === 'project' ? <ProjectEditForm row={row} onDone={done} onCancel={() => setEditing(null)} /> : null}
      <div className="proj-columns">
        <div className="proj-main">
          <Todos detail={detail} onChanged={reload} />
          <Lines projectId={row.id} />
          <ProjectTasks projectId={row.id} phone={false} navigate={navigate}
            head={(title) => <Head title={title} />} />
        </div>
        <div className="proj-side">
          <Profile detail={detail} editing={editing === 'brief'} onEdit={() => setEditing('brief')} onDone={done} />
          <Notes detail={detail} navigate={navigate} />
        </div>
      </div>
    </div>
  );
}

export function ProjectDetailPage({ projectId, navigate }: {
  projectId: string; navigate: (route: Route) => void;
}): ReactNode {
  const api = useApi();
  const timeZone = useStore(useLive().timeZone);
  const read = useCallback(
    (signal: AbortSignal) => api.projects.get(projectId, { tz: timeZone }, signal),
    [api, projectId, timeZone],
  );
  const { value, error, reload } = useProjectRead(read, projectId);
  const detail = value?.project.id === projectId ? value : null;
  if (detail === null) {
    return (
      <div className="page proj-page proj-detail">
        {error === null ? <PageLoading page /> : (
          <p className="proj-error" role="alert">
            {error} <button type="button" className="text-button" onClick={reload}>再读一次</button>
          </p>
        )}
      </div>
    );
  }
  return <Body detail={detail} reload={reload} navigate={navigate} />;
}
