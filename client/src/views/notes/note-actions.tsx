import { useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { NoteMetaView, NoteView } from '../../api/types.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { isOpenOp } from '../../state/action-ops.ts';
import { useNoteFolders } from './note-folders.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { anchorOf, MenuSeparator, Popover, type PopoverAnchor } from '../../shell/popover.tsx';

export function renameNoteMarkdown(markdown: string, title: string): string {
  const lines = markdown.split('\n');
  const index = lines.findIndex((line) => line.trim() !== '');
  if (index < 0) { return `# ${title}`; }
  const prefix = lines[index]?.match(/^#{1,6}\s+/)?.[0] ?? '';
  lines[index] = `${prefix}${title}`;
  return lines.join('\n');
}

/** 笔记 ⋯ 里排在最前面的几个动作（版本历史、笔记 AI 设置、删除笔记）：点了先收起再做。 */
export interface NoteExtraAction {
  label: string;
  icon: IconName;
  onSelect: () => void;
}

// 笔记 ⋯（2026-11-05 第 3 条）：里面有改名输入框和文件夹选择，是一张小表单，用 Popover role="dialog"，关闭逻辑和
// 下拉菜单是同一套（use-dismiss.ts）；表单里点、打字不收，点外面、Esc、切到网页、保存成功才收。
export function NoteActions({ note, beforeChange, changed, extra = [], label = '笔记操作', remove }: {
  note: NoteMetaView;
  label?: string;
  beforeChange?: () => Promise<NoteView | null>;
  changed?: (note: NoteView) => void;
  extra?: readonly NoteExtraAction[];
  /** 列表里一行的「⋯」（右键同一个）：最后一项「删除笔记」，进最近删除、能恢复（11-12 第 2 条）。 */
  remove?: (() => void) | undefined;
}): ReactNode {
  const api = useApi();
  const { actionOps, notesCache } = useClientState();
  const key = `note:${note.id}:metadata`;
  const operation = useStore(actionOps.store).find((entry) => entry.key === key);
  const unresolved = operation !== undefined && isOpenOp(operation);
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const [leaving, setLeaving] = useState(false);
  const open = anchor !== null && !leaving;
  const { folders } = useNoteFolders(anchor !== null);
  const [title, setTitle] = useState(note.title);
  const [folder, setFolder] = useState(note.folder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const show = (): void => {
    if (button.current === null) { return; }
    setTitle(note.title);
    setFolder(note.folder);
    setError(null);
    setLeaving(false);
    setAnchor(anchorOf(button.current));
  };
  const hide = (): void => { if (anchor !== null) { setLeaving(true); } };
  const mutate = async (kind: 'rename' | 'pin' | 'move'): Promise<void> => {
    if (pending.current || actionOps.get(key)?.status === 'running') { return; }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      let request = actionOps.retry(key);
      if (request === undefined) {
        const current = beforeChange === undefined ? await api.notes.get(note.id) : await beforeChange();
        if (current === null) { throw new Error('先处理未保存的正文，再改笔记信息。'); }
        const patch = kind === 'rename' ? { markdown: renameNoteMarkdown(current.markdown, title.trim()) }
          : kind === 'pin' ? { pinned: !current.pinned } : { folder };
        request = actionOps.begin(key, '修改笔记信息', note.title, (requestId) => ({
          kind: 'note_save', noteId: note.id, body: { ...patch, version: current.version, requestId },
        }), createRequestId);
      }
      if (request.kind !== 'note_save') { throw new Error('笔记操作不匹配，请刷新后再试。'); }
      const saved = await api.notes.save(note.id, request.body);
      notesCache.remember(saved);
      actionOps.succeed(key);
      changed?.(saved);
      setLeaving(true);
    } catch (cause) {
      actionOps.fail(key, cause);
      setError(errorText(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  if (note.deletedAt !== null) { return null; }
  const locked = busy || unresolved;
  const problem = error ?? operation?.error;
  return <>
    <IconButton ref={button} icon="more" className="note-actions" label={label} aria-haspopup="dialog" data-row-menu=""
      aria-expanded={open} data-open={open ? 'true' : undefined}
      onClick={() => { if (open) { hide(); } else { show(); } }} />
    {anchor === null ? null : <Popover anchor={anchor} role="dialog" align="end" label={label}
      className="note-actions-pop" trigger={button} leaving={leaving}
      onLeft={() => { setAnchor(null); setLeaving(false); }} onClose={hide}>
      {extra.map((action) => <button key={action.label} type="button" className="popover-item" onClick={() => {
        hide();
        action.onSelect();
      }}><Icon name={action.icon} size={15} /><span className="popover-item-label">{action.label}</span></button>)}
      <button type="button" className="popover-item" disabled={locked} onClick={() => void mutate('pin')}>
        <Icon name="pin" size={15} /><span className="popover-item-label">{note.pinned ? '取消置顶' : '置顶'}</span>
      </button>
      {note.readOnly ? null : <>
        <MenuSeparator />
        <form className="note-actions-field" onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() !== '') { void mutate('rename'); }
        }}>
          <label htmlFor={`${key}:title`}>标题</label>
          <div className="note-actions-line">
            <input id={`${key}:title`} className="popover-field" value={title} maxLength={80} disabled={locked}
              onChange={(event) => setTitle(event.target.value)} />
            <button type="submit" className="chip-button" disabled={locked || !title.trim()
              || title.trim() === note.title}>保存标题</button>
          </div>
        </form>
        <div className="note-actions-field">
          <label htmlFor={`${key}:folder`}>文件夹</label>
          <div className="note-actions-line">
            <select id={`${key}:folder`} className="popover-field" value={folder} disabled={locked}
              onChange={(event) => setFolder(event.target.value)}>
              {(folders?.folders ?? [{ name: note.folder }]).map((entry) => <option key={entry.name}>
                {entry.name}</option>)}
            </select>
            <button type="button" className="chip-button" disabled={locked || folder === note.folder}
              onClick={() => void mutate('move')}>移到此文件夹</button>
          </div>
        </div>
      </>}
      {problem == null ? null : <p role="alert" className="note-error note-actions-error">{problem}</p>}
      {!unresolved ? null : <button type="button" className="popover-item"
        disabled={busy || operation?.status === 'running'} onClick={() => void mutate('pin')}>
        <Icon name="refresh" size={15} /><span className="popover-item-label">再核实原操作</span>
      </button>}
      {remove === undefined || note.readOnly ? null : <>
        <MenuSeparator />
        <button type="button" className="popover-item is-danger" onClick={() => {
          hide();
          remove();
        }}><Icon name="trash" size={15} /><span className="popover-item-label">删除笔记</span></button>
      </>}
    </Popover>}
  </>;
}
