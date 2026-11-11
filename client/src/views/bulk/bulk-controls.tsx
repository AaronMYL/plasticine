import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { Icon } from '../../shell/icons.tsx';
import { bulkKey, type BulkItem, type BulkSelection } from './use-bulk-selection.ts';
import './bulk.css';

const KIND_NAMES = { note: '笔记', space: '空间', book: '图书', folder: '文件夹', file: '文件' } as const;
export function purgeSummary(items: readonly BulkItem[]): string {
  const pieces = Object.entries(KIND_NAMES).flatMap(([kind, label]) => {
    const rows = items.filter((item) => item.kind === kind);
    if (rows.length === 0) return [];
    const files = rows.reduce((count, item) => count + (item.fileCount ?? 0), 0);
    return [`${label} ${rows.length} 个${kind === 'folder' ? `（含 ${files} 个文件）` : ''}`];
  });
  return `删除后不能恢复：${pieces.join('、')}。`;
}

export function BulkCheck({ selection, item }: { selection: BulkSelection; item: BulkItem }): ReactNode {
  return selection.active ? <input type="checkbox" className="bulk-check" checked={selection.checked(item)}
    disabled={selection.busy} aria-label={`选择${item.title}`} onChange={() => undefined}
    onClick={(event) => { event.stopPropagation(); selection.toggle(item, event.shiftKey); }} /> : null;
}

export function BulkHeader({ selection, items, trash = false, allowEmpty = true, onEmpty }: {
  selection: BulkSelection; items: readonly BulkItem[]; trash?: boolean; allowEmpty?: boolean;
  onEmpty?: (confirmed: readonly BulkItem[]) => void;
}): ReactNode {
  const all = useRef<HTMLInputElement>(null);
  const [purging, setPurging] = useState<readonly BulkItem[] | null>(null);
  useEffect(() => { if (all.current !== null) all.current.indeterminate = selection.selected.length > 0
    && selection.selected.length < items.length; }, [selection.selected.length, items.length]);
  return <div className="bulk-header">
    {selection.active ? <><label className="bulk-all"><input ref={all} type="checkbox" className="bulk-check"
      checked={items.length > 0 && selection.selected.length === items.length} disabled={selection.busy}
      onChange={selection.all} />全选</label><span className="text-meta">已选 {selection.selected.length}</span>
      <button type="button" className="text-button" disabled={selection.busy} onClick={selection.finish}>完成</button>
    </> : <RevealMore label="更多操作" actions={[{ icon: 'check', label: '选择', disabled: items.length === 0,
      onSelect: () => selection.start() }]} />}
    {trash && allowEmpty ? <button type="button" className="secondary-button bulk-danger"
      disabled={items.length === 0 || selection.busy} onClick={() => setPurging([...items])}>
      <Icon name="trash" size={14} />清空</button> : null}
    {purging === null ? null : <ConfirmDialog title={`永久删除这 ${purging.length} 项？`}
      body={purgeSummary(purging)} confirmLabel={`永久删除 ${purging.length} 项`}
      onCancel={() => setPurging(null)} onConfirm={() => {
        const count = purging.length;
        setPurging(null);
        if (onEmpty !== undefined) onEmpty(purging);
        else void selection.empty(count);
      }} />}
  </div>;
}

export function BulkFeedback({ selection }: { selection: BulkSelection }): ReactNode {
  const { report, error } = selection;
  if (report === null && error === null) return null;
  return <div className="bulk-feedback" data-failed={error !== null || (report?.failed ?? 0) > 0}
    role={error !== null || (report?.failed ?? 0) > 0 ? 'alert' : 'status'}>
    <div><p>{error ?? `完成 ${report!.succeeded} 项${report!.failed > 0 ? `，${report!.failed} 项没完成` : ''}`}</p>
      {report === null || report.failed === 0 ? null : <ul>{report.results.filter((item) => !item.ok)
        .map((item) => <li key={bulkKey(item)}>「{item.title}」：{item.error}</li>)}</ul>}</div>
    {selection.canRetry ? <button type="button" className="secondary-button" disabled={selection.busy}
      onClick={() => void selection.retry()}>{selection.uncertain ? '再核实'
        : `重试 ${report?.failed ?? selection.selected.length} 项`}</button> : null}
  </div>;
}

function MoveDialog({ items, folders, onMove, onClose }: { items: readonly BulkItem[]; folders: readonly string[];
  onMove: (destination: string) => void; onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  const before = useRef(document.activeElement);
  const id = useId();
  const [value, setValue] = useState('');
  useEffect(() => {
    if (typeof ref.current?.showModal === 'function') ref.current.showModal();
    else ref.current?.setAttribute('open', '');
    return () => { if (before.current instanceof HTMLElement) before.current.focus(); };
  }, []);
  return createPortal(<dialog ref={ref} className="bulk-move-dialog" aria-label="移动所选项目"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); onMove(value.trim()); }}>
      <h2 className="confirm-title">移动 {items.length} 项</h2>
      <label className="field">目标文件夹<input autoFocus className="field-input" list={id} value={value}
        onChange={(event) => setValue(event.target.value)} /></label>
      <datalist id={id}>{folders.map((name) => <option key={name} value={name} />)}</datalist>
      <div className="confirm-actions"><button type="button" className="secondary-button" onClick={onClose}>
        取消</button><button type="submit" className="primary-button">移动</button></div>
    </form>
  </dialog>, document.body);
}

export function BulkBar({ selection, trash = false, folders = [] }: { selection: BulkSelection; trash?: boolean;
  folders?: readonly string[] }): ReactNode {
  const [pending, setPending] = useState<{ action: 'move' | 'trash' | 'purge'; items: BulkItem[] } | null>(null);
  if (!selection.active) return null;
  const disabled = selection.busy || selection.selected.length === 0;
  const ask = (action: 'move' | 'trash' | 'purge'): void => setPending({ action, items: [...selection.selected] });
  return <>
    <div className="bulk-bar" aria-label="批量操作">
      <span className="text-meta">已选 {selection.selected.length}</span>
      {trash ? <>
        <button type="button" className="text-button" disabled={disabled}
          onClick={() => void selection.perform('restore')}><Icon name="undo" size={16} />还原</button>
        <button type="button" className="text-button bulk-danger" disabled={disabled}
          onClick={() => ask('purge')}><Icon name="trash" size={16} />永久删除</button>
      </> : <>
        <button type="button" className="text-button" disabled={disabled}
          onClick={() => ask('move')}><Icon name="folder" size={16} />移到…</button>
        <button type="button" className="text-button bulk-danger" disabled={disabled}
          onClick={() => ask('trash')}><Icon name="trash" size={16} />删除</button>
      </>}
    </div>
    {pending === null ? null : pending.action === 'move' ? <MoveDialog items={pending.items} folders={folders}
      onClose={() => setPending(null)} onMove={(destination) => {
        setPending(null); void selection.perform('move', destination, pending.items);
      }} /> : <ConfirmDialog title={`${pending.action === 'purge' ? '永久删除' : '删除'}这 ${pending.items.length} 项？`}
      body={pending.action === 'purge' ? purgeSummary(pending.items) : '会移到「最近删除」，在那里可以还原。'}
      confirmLabel={`${pending.action === 'purge' ? '永久删除' : '删除'} ${pending.items.length} 项`}
      onCancel={() => setPending(null)} onConfirm={() => {
        setPending(null); void selection.perform(pending.action, undefined, pending.items);
      }} />}
  </>;
}
