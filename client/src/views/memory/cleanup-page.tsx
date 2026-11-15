// 全量整理的改动清单（11-11 记忆改版，设计稿「全量整理」）：一条一个勾，默认都勾上；分段按改法筛（合并 / 挪位置 /
// 归档 / 改写 / 新加）。「采用这 n 条」才改，没勾的一行不动；「都不要」整份了结。说法冲突不在清单里，记忆首页的
// 冲突提示条点进去选。

import { useMemo, useState, type ReactNode } from 'react';
import type { CleanupItemView } from '../../api/shared.ts';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { PickAll, PickBar } from '../bulk/pick-controls.tsx';
import { Icon } from '../../shell/icons.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import { useCleanup } from './use-cleanup.ts';
import './cleanup.css';

const KIND_LABELS: Readonly<Record<CleanupItemView['kind'], string>> = {
  merge: '合并', move: '挪位置', archive: '归档', rewrite: '改写', add: '新加',
};
type Filter = 'all' | CleanupItemView['kind'];

function ItemBody({ item }: { item: CleanupItemView }): ReactNode {
  const struck = item.kind === 'archive' || item.kind === 'merge' || item.kind === 'rewrite';
  return (
    <span className="cleanup-item-body">
      <span className="tag tag-neutral">{KIND_LABELS[item.kind]}</span>
      {item.lines.map((line) => (
        <span key={line.id} className="cleanup-line">
          <span data-struck={struck || undefined}>{line.text}</span>
          <span className="cleanup-meta">{line.docTitle}</span>
        </span>
      ))}
      {item.kind === 'move' && item.toDocTitle !== null
        ? <span className="cleanup-to">→ {item.toDocTitle}</span> : null}
      {item.text === null ? null : <span className="cleanup-to">
        {item.kind === 'add' && item.toDocTitle !== null ? `${item.toDocTitle}：` : '→ '}{item.text}</span>}
      {item.reason === '' ? null : <span className="cleanup-meta">{item.reason}</span>}
    </span>
  );
}

export function CleanupPage({ onBack }: { onBack?: (() => void) | undefined }): ReactNode {
  const cleanup = useCleanup();
  const view = cleanup.data?.cleanup ?? null;
  const pending = useMemo(() => view?.items.filter((item) => item.applied === null) ?? [], [view]);
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const chosen = pending.filter((item) => !off.has(item.id)).map((item) => item.id);
  const kinds = (Object.keys(KIND_LABELS) as CleanupItemView['kind'][])
    .filter((kind) => pending.some((item) => item.kind === kind));
  const shown = pending.filter((item) => filter === 'all' || item.kind === filter);
  const submit = async (ids: readonly string[]): Promise<void> => {
    setBusy(true);
    const result = await cleanup.apply(ids);
    setBusy(false);
    setNote(typeof result === 'string' ? result
      : `改了 ${result.applied} 条${result.stale > 0 ? `，${result.stale} 条在这期间变过，没改` : ''}。`);
  };
  /** 清单本体：还在读、没有清单、正在整理、没整理成、一条条让他挑。 */
  const body = (): ReactNode => {
    if (cleanup.data === null) return <PageLoading />;
    if (view === null || (view.status !== 'running' && pending.length === 0)) {
      return <p className="block-empty">现在没有要看的整理清单。回记忆首页点「全量整理」开始一次。</p>;
    }
    if (view.status === 'running') {
      return <><p className="block-empty" role="status">正在整理全部记忆，好了这页会自己换。</p>
        <PageLoading rows={6} dense /></>;
    }
    if (view.status === 'failed') {
      return <p className="block-empty is-error" role="alert">这次没整理成：{view.error}</p>;
    }
    return <>
      <div className="segmented cleanup-filter" role="group" aria-label="按改法看">
        {(['all', ...kinds] as Filter[]).map((kind) => (
          <button key={kind} type="button" className="segmented-item" aria-pressed={filter === kind}
            onClick={() => setFilter(kind)}>
            {kind === 'all' ? '全部' : KIND_LABELS[kind]}{' '}
            <span className="seg-count">{kind === 'all' ? pending.length
              : pending.filter((item) => item.kind === kind).length}</span>
          </button>
        ))}
      </div>
      <PickAll total={pending.length} picked={chosen.length} disabled={busy}
        onAll={(on) => setOff(on ? new Set() : new Set(pending.map((item) => item.id)))} />
      <ul className="cleanup-list">
        {shown.map((item) => (
          <li key={item.id}>
            <label className="cleanup-item">
              <input type="checkbox" checked={!off.has(item.id)} aria-label={`采用：${KIND_LABELS[item.kind]}`}
                onChange={(event) => setOff((old) => {
                  const next = new Set(old);
                  if (event.target.checked) next.delete(item.id); else next.add(item.id);
                  return next;
                })} />
              <ItemBody item={item} />
            </label>
          </li>
        ))}
      </ul>
      <PickBar picked={chosen.length}>
        <button type="button" className="text-button" disabled={busy} onClick={() => void submit([])}>
          <Icon name="close" size={16} />都不要</button>
        <button type="button" className="primary-button" disabled={busy || chosen.length === 0}
          onClick={() => void submit(chosen)}>采用这 {chosen.length} 条</button>
      </PickBar>
    </>;
  };
  return (
    <div className="page memory-cleanup">
      <PageHeader title="整理清单" onBack={onBack} />
      {cleanup.error === null ? null : <p className="block-empty is-error" role="alert">{cleanup.error}{' '}
        <button type="button" className="text-button" onClick={cleanup.reload}>再读一次</button></p>}
      {note === null ? null : <p className="block-empty" role="status">{note}</p>}
      {body()}
    </div>
  );
}
