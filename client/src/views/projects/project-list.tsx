// 项目列表：每个项目一行（名字 · 健康度 · 一句现状 · 下一步 | 待办 | 在做 / 等你 | 截止 | 更新），常驻的排最后。
// 页头：进行 · 逾期 · 本周到期（「等你 n」每屏只出现一次，在对话栏，这里不重复总数）；按状态分段筛；新建项目。

import { IconButton } from '../../shell/icon-button.tsx';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { FlipList } from '../../shell/flip-list.tsx';
import { useCallback, useContext, useState, type FormEvent, type ReactNode } from 'react';
import { TabsContext } from '../../shell/tabs-context.ts';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { ProjectRowView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import type { Route } from '../../shell/routes.ts';
import { useStore } from '../../state/use-store.ts';
import { ago, dueNote, HealthMark, NodeBar, shortDate, shownHealth } from './project-parts.tsx';

import { useProjectRead } from './use-project-read.ts';
import { PageLoading } from '../../primitives/page-loading/index.tsx';

const FILTERS = [
  { id: 'active', label: '进行' },
  { id: 'waiting', label: '等你' },
  { id: 'paused', label: '暂停' },
  { id: 'done', label: '完成' },
] as const;
type Filter = (typeof FILTERS)[number]['id'];

function matches(row: ProjectRowView, filter: Filter): boolean {
  if (filter === 'waiting') {
    return row.waitingOnYou > 0;
  }
  return row.lifecycle === filter;
}

function Row({ row, open }: { row: ProjectRowView; open: (id: string) => void }): ReactNode {
  const { health, proposed } = shownHealth(row);
  const overdue = row.dueInDays !== null && row.dueInDays < 0;
  return (
    <li className="proj-row">
      <button type="button" className="proj-row-main" onClick={() => open(row.id)}>
        <span className="proj-row-title">
          <span className="proj-name">{row.name}</span>
          <HealthMark health={health} proposed={proposed} />
          {row.standing ? <span className="proj-standing" role="img" aria-label="常驻" title="常驻">
            <Icon name="pin" size={12} /></span> : null}
        </span>
        {/* 第 109 条：没有现状就不写「还没有现状」。 */}
        {row.status === null ? null : <span className="proj-status">{row.status.text}</span>}
        {row.next === null ? null : <span className="proj-next text-meta" title="下一步">
          <Icon name="forward" size={12} /> {row.next}</span>}
      </button>
      <span className="proj-cell proj-cell-nodes"><NodeBar done={row.todosDone} total={row.todosTotal} /></span>
      <span className="proj-cell proj-cell-tasks text-meta">
        {row.running === 0 ? null : <span className="proj-wait" title={`在做 ${row.running}`}>
          <StatusGlyph status="run" /><span className="text-mono proj-num">{row.running}</span></span>}
        {row.waitingOnYou > 0 ? (
          <span className="proj-wait" title={`等你 ${row.waitingOnYou}`}>
            <StatusGlyph status="wait" /><span className="text-mono proj-num">{row.waitingOnYou}</span>
          </span>
        ) : null}
      </span>
      <span className={overdue ? 'proj-cell proj-due proj-overdue text-meta' : 'proj-cell proj-due text-meta'}>
        {row.due === null || row.dueInDays === null ? null : (
          <>
            <span className="text-mono">{shortDate(row.due)}</span>
            <span className="proj-due-note">{dueNote(row.dueInDays)}</span>
          </>
        )}
      </span>
      <span className="proj-cell proj-updated text-meta">{ago(row.touchedAt, new Date())}</span>
    </li>
  );
}

function NewProject({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }): ReactNode {
  const api = useApi();
  const [name, setName] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (name.trim() === '' || busy) {
      return;
    }
    setBusy(true);
    const input = { requestId: createRequestId(), name: name.trim(), due: due === '' ? null : due };
    api.projects.create(input).then((row) => onCreated(row.id), (cause: unknown) => {
      setError(errorText(cause));
      setBusy(false);
    });
  };
  return (
    <form className="proj-new-form" onSubmit={submit} aria-label="新建项目">
      <label className="field">
        <span className="field-label">名字</span>
        <input className="field-input" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </label>
      <label className="field">
        <span className="field-label">截止（可不填）</span>
        <input className="field-input" type="date" value={due} onChange={(event) => setDue(event.target.value)} />
      </label>
      <div className="proj-form-foot">
        <button type="submit" className="primary-button" disabled={name.trim() === '' || busy}>建好</button>
        <button type="button" className="text-button" onClick={onCancel}>取消</button>
        {error === null ? null : <span className="proj-error" role="alert">{error}</span>}
      </div>
    </form>
  );
}

export function ProjectList({ navigate }: { navigate: (route: Route) => void }): ReactNode {
  const api = useApi();
  const timeZone = useStore(useLive().timeZone);
  const [filter, setFilter] = useState<Filter>('active');
  const [creating, setCreating] = useState(false);
  const read = useCallback(
    (signal: AbortSignal) => api.projects.list({ tz: timeZone, includeDone: true }, signal),
    [api, timeZone],
  );
  const { value, error, loading, reload } = useProjectRead(read);
  const tabs = useContext(TabsContext);
  // 第 111 条：项目开成自己的标签（进这个项目的组）；没有标签壳（单独渲染这一页）时就地进详情。
  const open = (id: string): void => {
    const route: Route = { view: 'projects', noteId: null, projectId: id };
    const name = value?.projects.find((row) => row.id === id)?.name ?? null;
    if (tabs === null) {
      navigate(route);
    } else {
      tabs.openTab(route, name);
    }
  };
  const rows = (value?.projects ?? []).filter((row) => matches(row, filter));
  const controls = (
    <>
      <div className="segmented" role="group" aria-label="按状态看">
        {FILTERS.map((item) => (
          <button key={item.id} type="button" className="segmented-item" aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}>{item.label}
            {value === null ? null : <span className="seg-count">
              {value.projects.filter((row) => matches(row, item.id)).length || ''}</span>}</button>
        ))}
      </div>
      <IconButton icon="plus" label="新建项目" onClick={() => setCreating(true)} />
    </>
  );
  return (
    <div className="page proj-page">
      <PageHeader title="项目" controls={controls} />
      {creating ? <NewProject onCancel={() => setCreating(false)} onCreated={(id) => { reload(); open(id); }} /> : null}
      {error === null ? null : (
        <p className="proj-error" role="alert">
          {error} <button type="button" className="text-button" onClick={reload}>再读一次</button>
        </p>
      )}
      <section className="block" aria-label="项目列表">
        {/* 2026-11-03：列头去掉，列里的东西自己说明是什么（分段条 = 待办，符号 = 在做的线 / 等你，日期 = 截止）。 */}
        {loading && value === null ? <PageLoading dense /> : null}
        {value !== null && rows.length === 0 ? <p className="block-empty">这一栏没有项目。</p> : null}
        <FlipList className="proj-list" keys={rows.map((row) => row.id)}>
          {rows.map((row) => <Row key={row.id} row={row} open={open} />)}
        </FlipList>
      </section>
    </div>
  );
}
