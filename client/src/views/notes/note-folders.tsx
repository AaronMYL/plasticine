import { useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { isAiFolder } from './ai-folder.ts';
import { useApi } from '../../api/context.tsx';
import { createRequestId } from '../../api/request-id.ts';
import type { NoteFolderCommand, NoteFoldersView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { noteFoldersCache } from '../../state/note-folders-cache.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { isOpenOp } from '../../state/action-ops.ts';
import { PendingOps, useOp } from '../pending/pending-ops.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import './note-folders.css';

import type { NoteCollection } from '../../state/notes-ui.ts';
export type { NoteCollection } from '../../state/notes-ui.ts';

/** 文件夹列表：先给上次的（state/note-folders-cache.ts），后台核实；enabled 为 false 时只读手上的、不去拉。 */
export function useNoteFolders(enabled = true): {
  folders: NoteFoldersView | null; error: string | null; reload: () => void;
} {
  const api = useApi();
  const live = useLive();
  const cache = noteFoldersCache(api.notes);
  const { folders, error } = useStore(cache.store);
  useEffect(() => {
    if (!enabled) { return undefined; }
    return cache.observe(live.hub);
  }, [cache, live, enabled]);
  return { folders, error, reload: () => { void cache.load(); } };
}

interface Props {
  value: NoteCollection;
  onChange: (value: NoteCollection) => void;
  inline?: boolean;
  /** 画在笔记栏目的第二栏里（11-07 两层侧栏）：只放他自己写的，「Plasticine 写的」在资料库的空间里。 */
  column?: boolean;
  open?: boolean;
  phone?: boolean;
  onClose?: () => void;
}

/** 文件夹的图标（2026-11-05 设计稿 Notes）：全部是笔，文件夹是夹子，「Plasticine 写的」是星，最近删除是垃圾桶。 */
function folderIcon(target: NoteCollection): IconName {
  if (target.kind === 'all') return 'notes';
  if (target.kind === 'deleted') return 'trash';
  return target.kind === 'folder' && isAiFolder(target.name) ? 'sparkle' : 'folder';
}

/** 「Plasticine 写的」排在第一个固定文件夹（笔记）后面，别的照服务端的顺序。 */
function arrangeFolders<T extends { name: string }>(list: readonly T[]): T[] {
  const ai = list.filter((folder) => isAiFolder(folder.name));
  const rest = list.filter((folder) => !isAiFolder(folder.name));
  return [...rest.slice(0, 1), ...ai, ...rest.slice(1)];
}

const OP = 'note-folders:change';
const FIELDS = ['mode', 'folder', 'name', 'destination'] as const;

export function NoteFolders({
  value, onChange, inline = true, column = false, open = false, phone = false, onClose,
}: Props): ReactNode {
  const api = useApi();
  const { actionOps, inlineDrafts, notesUi } = useClientState();
  const { folders, error: loadError, reload } = useNoteFolders();
  const drafts = useStore(inlineDrafts.store);
  const [managing, setManaging] = useState(false);
  const operation = useOp(OP);
  const locked = operation !== undefined && isOpenOp(operation);
  const sent = locked && operation.request.kind === 'note_folder' ? operation.request.body : null;
  const mode = drafts.get(`${OP}:mode`);
  const editing = sent !== null ? sent.action === 'create' ? '' : sent.name
    : mode === 'new' ? '' : mode === 'existing' ? drafts.get(`${OP}:folder`) ?? null : null;
  const name = sent !== null ? sent.action === 'rename' ? sent.next : sent.name : drafts.get(`${OP}:name`) ?? '';
  const destination = sent?.action === 'remove' ? sent.destination : drafts.get(`${OP}:destination`) ?? '笔记';
  const closePanel = (): void => { setManaging(false); onClose?.(); };
  const close = (): void => {
    for (const field of FIELDS) { inlineDrafts.clear(`${OP}:${field}`); }
    setManaging(false);
  };
  const edit = (folder: string | null): void => {
    setManaging(true);
    if (mode === (folder === null ? 'new' : 'existing') && drafts.get(`${OP}:folder`) === (folder ?? '')) return;
    actionOps.dismiss(OP);
    inlineDrafts.set(`${OP}:mode`, folder === null ? 'new' : 'existing');
    inlineDrafts.set(`${OP}:folder`, folder ?? '');
    inlineDrafts.set(`${OP}:name`, folder ?? '');
    inlineDrafts.clear(`${OP}:destination`);
  };
  const run = async (build?: (requestId: string) => NoteFolderCommand): Promise<void> => {
    if (actionOps.get(OP)?.status === 'running') { return; }
    const request = build === undefined ? actionOps.retry(OP)
      : actionOps.begin(OP, '修改文件夹', editing || name.trim(), (requestId) => ({
        kind: 'note_folder', body: build(requestId),
      }), createRequestId);
    if (request?.kind !== 'note_folder') { return; }
    const command = request.body;
    try {
      await api.notes.changeFolder(command);
      actionOps.succeed(OP);
      const current = notesUi.store.get().collection;
      if (command.action === 'rename' && current.kind === 'folder' && current.name === command.name) {
        notesUi.set({ collection: { kind: 'folder', name: command.next } });
      }
      if (command.action === 'remove' && current.kind === 'folder' && current.name === command.name) {
        notesUi.set({ collection: { kind: 'folder', name: command.destination } });
      }
      close();
      reload();
    } catch (cause) { actionOps.fail(OP, cause); }
  };
  const folderButton = (label: string, count: number, target: NoteCollection): ReactNode => {
    const active = target.kind === value.kind && (target.kind !== 'folder'
      || value.kind === 'folder' && target.name === value.name);
    return <button type="button" className="note-folder-button" aria-label={`${label} ${count}`} title={label}
      aria-current={active ? 'true' : undefined} data-ai={target.kind === 'folder' && isAiFolder(target.name)}
      onClick={() => onChange(target)}>
      <span className="note-folder-icon" aria-hidden="true"><Icon name={folderIcon(target)} size={15} /></span>
      <span className="note-folder-name">{label}</span><span className="note-folder-count">{count}</span>
    </button>;
  };
  const row = (label: string, count: number, target: NoteCollection, editable = false): ReactNode => (
    <div className="note-folder-row" key={label}>
      {folderButton(label, count, target)}
      {editable ? <IconButton icon="more" className="note-folder-manage" label={`管理文件夹${label}`}
        disabled={locked} onClick={() => edit(label)} /> : <span className="note-folder-spacer" aria-hidden />}
    </div>
  );
  const navigation = (isInline: boolean): ReactNode => (
    <aside className="note-folders" aria-label="笔记文件夹" data-inline={isInline} data-column={column}>
      {isInline && !column ? <div className="note-folders-head">
        <h2>文件夹</h2>
        <IconButton icon="plus" label="新建文件夹" disabled={locked} onClick={() => edit(null)} />
      </div> : null}
      {row('全部', folders?.allCount ?? 0, { kind: 'all' })}
      <div className="note-folder-group">
        {arrangeFolders(folders?.folders ?? []).filter((folder) => !column || !isAiFolder(folder.name))
          .map((folder) => row(folder.name, folder.count, { kind: 'folder', name: folder.name },
            !folder.fixed && !isAiFolder(folder.name)))}
        {column ? <button type="button" className="note-folder-button note-folder-new" disabled={locked}
          onClick={() => edit(null)}>
          <span className="note-folder-icon" aria-hidden="true"><Icon name="plus" size={15} /></span>
          <span className="note-folder-name">新建文件夹</span>
        </button> : null}
      </div>
      <div className="note-folder-archive">
        {row('最近删除', folders?.deletedCount ?? 0, { kind: 'deleted' })}
      </div>
      {loadError === null ? null : <p className="note-error" role="alert">{loadError}
        <button type="button" className="text-button" onClick={reload}>重试</button>
      </p>}
    </aside>
  );
  const pending = <PendingOps label="还没了结的文件夹操作" prefixes={[OP]} visible={() => false}
    onRetry={() => void run()} />;
  const form = editing === null ? null : (
    <form className="note-folder-edit" onSubmit={(event) => {
      event.preventDefault();
      void run((requestId) => editing === '' ? { action: 'create', name: name.trim(), requestId }
        : { action: 'rename', name: editing, next: name.trim(), requestId });
    }}>
      {pending}
      <label>文件夹名称<input className="search-input" value={name} maxLength={100} disabled={locked}
        onChange={(event) => inlineDrafts.set(`${OP}:name`, event.target.value)} /></label>
      <div className="note-toolbar">
        <button className="primary-button" type="submit" disabled={locked || !name.trim()}>
          {editing === '' ? '创建文件夹' : '保存名称'}
        </button>
        <button type="button" className="text-button" disabled={locked}
          onClick={() => { close(); onClose?.(); }}>取消</button>
      </div>
      {editing === '' ? null : <>
        <div className="note-folder-position"><span>位置</span>
          {([-1, 1] as const).map((direction) => <IconButton key={direction}
            icon={direction === -1 ? 'chevron-up' : 'chevron-down'} label={direction === -1 ? '上移' : '下移'}
            disabled={locked} onClick={() => void run((requestId) => ({
              action: 'move', name: editing, direction, requestId,
            }))} />)}
        </div>
        <details className="note-folder-remove">
          <summary>移除文件夹</summary>
          <label>笔记移到<select value={destination} disabled={locked}
            onChange={(event) => inlineDrafts.set(`${OP}:destination`, event.target.value)}>
            {folders?.folders.filter((folder) => folder.name !== editing).map((folder) =>
              <option key={folder.name} value={folder.name}>{folder.name}</option>)}
          </select></label>
          <button className="chip-button" type="button" disabled={locked} onClick={() => void run((requestId) => ({
            action: 'remove', name: editing, destination, requestId,
          }))}>移走笔记并移除文件夹</button>
        </details>
      </>}
    </form>
  );
  return <>
    {operation === undefined || managing ? null : <div className="notes-folder-pending">{pending}</div>}
    {inline ? navigation(true) : null}
    <Sheet open={open || managing} variant={phone ? 'drawer' : 'panel'} onClose={closePanel}
      title={managing ? editing === '' ? '新建文件夹' : '管理文件夹' : '文件夹'}
      actions={managing ? undefined : <IconButton icon="plus" label="新建文件夹" disabled={locked}
        onClick={() => edit(null)} />}>
      {managing ? form : navigation(false)}
    </Sheet>
  </>;
}
