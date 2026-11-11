// 记忆里的「规则」（11-11 第 11 批第二步，设计稿 M2 / M4）：原来的「主线的 Soul」和每位队友的 Soul 并成一份。
// 顶上按适用范围筛（全部 / 所有队友共用 / 每位有专属规则的队友），下面按说话、做事、对外分节；每条写来源和日子，
// 只对某位队友的带它的头像。点一条在右边（手机上是底部弹层）看来源原话、改范围、为什么以它为准、修改和删除。

import { useMemo, useState, type ReactNode } from 'react';
import { hardLines, SOUL_SECTIONS, SOUL_SECTION_LABELS, type SoulLine } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { Icon } from '../../shell/icons.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import { conflictsRoute, routeHash, type Route } from '../../shell/routes.ts';
import { useStore } from '../../state/use-store.ts';
import { useSoul } from '../plasticine/use-soul.ts';
import { RuleDetail, RuleEditor, RuleRow } from './rule-parts.tsx';
import { HardLines } from './topic-doc.tsx';
import { useConflicts } from './use-conflicts.ts';
import './rules.css';

export interface RulesPageProps {
  /** 先筛出只对这位队友的；null 是全部。 */
  mateId: string | null;
  phone: boolean;
  navigate: (route: Route) => void;
  onBack?: (() => void) | undefined;
}

type Filter = 'all' | 'shared' | string;

function matches(line: SoulLine, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'shared') return line.scopeKind === 'all';
  return line.scopeKind === 'mate' && line.scopeRef === filter;
}

export function RulesPage({ mateId, phone, navigate, onBack }: RulesPageProps): ReactNode {
  const soul = useSoul();
  const conflicts = useConflicts();
  const mates = useStore(useLive().mates.data).mates;
  const [filter, setFilter] = useState<Filter>(mateId ?? 'shared');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState(false);
  const busy = soul.operation !== undefined && soul.operation.status !== 'failed';
  const lines = soul.value?.lines ?? [];
  const inConflict = useMemo(() => new Set(conflicts.data?.conflicts.flatMap((item) =>
    item.lines.map((line) => line.id)) ?? []), [conflicts.data]);
  const scoped = mates.filter((mate) => lines.some((line) => line.scopeKind === 'mate' && line.scopeRef === mate.id));
  const shown = lines.filter((line) => matches(line, filter));
  const selected = lines.find((line) => line.id === selectedId) ?? null;
  const choose = (next: Filter): void => {
    setSelectedId(null);
    setFilter(next);
  };
  const scopeOf = (): { scopeKind: 'all' | 'mate'; scopeRef: string | null } =>
    filter === 'all' || filter === 'shared' ? { scopeKind: 'all', scopeRef: null }
      : { scopeKind: 'mate', scopeRef: filter };
  const detail = selected === null ? null : <RuleDetail key={selected.id} line={selected} mates={mates}
    history={soul.value?.history ?? []} busy={busy} inSheet={phone} onClose={() => setSelectedId(null)}
    onEdit={(text, section) => void soul.change({ action: 'edit', id: selected.id, version: selected.version, text,
      section }).then((done) => { if (done) setSelectedId(null); })}
    onScope={(target) => void soul.change({ action: 'scope', id: selected.id, version: selected.version,
      scopeKind: target === null ? 'all' : 'mate', scopeRef: target })}
    onDelete={() => void soul.change({ action: 'undo', id: selected.id, version: selected.version })
      .then((done) => { if (done) setSelectedId(null); })} />;
  return <div className="page rules-page" data-detail={selected !== null && !phone}>
    <div className="rules-main">
      {phone ? null : <nav className="rules-crumb" aria-label="位置"><a href="#/memory" onClick={(event) => {
        event.preventDefault();
        navigate({ view: 'memory', noteId: null });
      }}>记忆</a><span aria-hidden="true">/</span></nav>}
      <PageHeader title="规则" onBack={onBack} phoneSearch={false} controls={<button type="button"
        className="secondary-button button-small" aria-expanded={history} onClick={() => setHistory((open) => !open)}>
        <Icon name="history" size={14} />改动记录</button>} />
      {conflicts.data === null || conflicts.data.conflicts.length === 0 ? null : <a className="rules-conflicts"
        href={routeHash(conflictsRoute())} onClick={(event) => { event.preventDefault(); navigate(conflictsRoute()); }}>
        <Icon name="alert" size={16} /><span>{conflicts.data.conflicts.length} 处说法冲突，要你选以哪条为准</span>
        <Icon name="chevron-right" size={14} /></a>}
      <div className="segmented rules-filter" role="group" aria-label="适用范围">
        <button type="button" className="segmented-item" aria-pressed={filter === 'all'}
          onClick={() => choose('all')}>全部<span className="seg-count">{lines.length}</span></button>
        <button type="button" className="segmented-item" aria-pressed={filter === 'shared'}
          onClick={() => choose('shared')}>所有队友共用<span className="seg-count">
            {lines.filter((line) => matches(line, 'shared')).length}</span></button>
        {scoped.map((mate) => <button key={mate.id} type="button" className="segmented-item"
          aria-pressed={filter === mate.id} onClick={() => choose(mate.id)}>{mate.name}
          <span className="seg-count">{lines.filter((line) => matches(line, mate.id)).length}</span></button>)}
      </div>
      {soul.error === null ? null : <p className="rules-error" role="alert">{soul.error}
        <button type="button" className="text-button" onClick={soul.reload}>再读一次</button></p>}
      {soul.operation?.error == null ? null : <p className="rules-error" role="alert">{soul.operation.error}
        <button type="button" className="text-button" onClick={() => void soul.retry()}>
          {soul.operation.status === 'uncertain' ? '再核实' : '重发'}</button></p>}
      {history && soul.value !== null ? <section className="rules-history" aria-label="改动记录">
        {soul.value.history.length === 0 ? <p className="rule-meta">还没有改动</p> : <ol>
          {soul.value.history.slice(0, 30).map((change) => <li key={change.id}><span>{change.text}</span>
            <time dateTime={change.at}>{change.at.slice(5, 10)}</time></li>)}</ol>}
      </section> : null}
      <HardLines lines={hardLines()} />
      {soul.value === null && soul.error === null ? <PageLoading /> : SOUL_SECTIONS.map((section) => {
        const group = shown.filter((line) => line.section === section);
        return group.length === 0 ? null : <section className="rules-section" key={section}
          aria-labelledby={`rules-${section}`}>
          <h2 id={`rules-${section}`}>{SOUL_SECTION_LABELS[section]}</h2>
          <ul>{group.map((line) => <RuleRow key={line.id} line={line} mates={mates} selected={line.id === selectedId}
            conflict={inConflict.has(line.id)}
            onOpen={() => setSelectedId(line.id === selectedId ? null : line.id)} />)}
          </ul>
        </section>;
      })}
      {adding ? <RuleEditor line={null} busy={busy} onCancel={() => setAdding(false)} onSave={(text, section) => {
        void soul.change({ action: 'add', text, section, ...scopeOf() })
          .then((done) => { if (done) setAdding(false); });
      }} /> : <button type="button" className="rules-add" disabled={busy} onClick={() => setAdding(true)}>
        <Icon name="plus" size={14} />加一条</button>}
    </div>
    {phone ? <Sheet open={selected !== null} variant="drawer" title="这一条" onClose={() => setSelectedId(null)}>
      {detail}</Sheet> : selected === null ? null : <aside className="rules-aside" aria-label="这一条">{detail}</aside>}
  </div>;
}
