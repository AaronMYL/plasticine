import { BulkHeader, BulkCheck, BulkBar, BulkFeedback } from '../bulk/bulk-controls.tsx';
import type { BulkSelection } from '../bulk/use-bulk-selection.ts';
import { AiMark } from '../../shell/glyph.tsx';
import { isAiNote } from './ai-folder.ts';
import { useState, type ReactNode } from 'react';
import type { SkippedFileView } from '../../api/shared.ts';
import { SkippedFiles } from '../transfer/skipped-files.tsx';
import { useFilePicker } from '../transfer/use-file-picker.tsx';
import { exportNoteFiles, importNoteFiles, NOTE_IMPORT_ACCEPT } from './note-transfer.ts';
import type { NoteMetaView } from '../../api/types.ts';
import { Icon } from '../../shell/icons.tsx';
import { useRememberedScroll } from '../../state/use-remembered-scroll.ts';
import { NoteActions } from './note-actions.tsx';
import { removeNoteWithUndo } from './note-delete.ts';
import { useApi } from '../../api/context.tsx';
import { useClientState } from '../../state/context.tsx';
import { groupByDay } from './note-time.ts';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { timeText } from '../../shell/time-text.ts';
import { SearchField } from '../../primitives/search-field/index.tsx';

export interface NoteListProps {
  selection?: BulkSelection;
  trash?: boolean;
  feedback?: boolean;
  folders?: string[];
  notes: NoteMetaView[] | null;
  error: string | null;
  selectedId: string | null;
  query: string;
  onQuery: (query: string) => void;
  onOpen: (id: string) => void;
  showFolder?: boolean;
  hidden?: boolean;
  collectionLabel?: string;
  onFolders?: ((button: HTMLElement) => void) | undefined;
  foldersOpen?: boolean;
  onRetry?: () => void;
  heading?: boolean;
  tools?: ReactNode;
  trail?: ReactNode;
  onCreate?: () => void;
  importFolder?: string | null | undefined;
}

export function NoteList(props: NoteListProps): ReactNode {
  const { ref, onScroll } = useRememberedScroll<HTMLDivElement>('notes:list', props.notes !== null);
  const now = new Date();
  const api = useApi();
  const { noteOps } = useClientState();
  const [skipped, setSkipped] = useState<SkippedFileView[]>([]);
  const canImport = props.importFolder !== undefined && props.trash !== true;
  const picker = useFilePicker({ accept: NOTE_IMPORT_ACCEPT, label: '选要导入的笔记文件', onFiles: (files) => {
    setSkipped([]);
    void importNoteFiles(api, files, props.importFolder ?? null).then((left) => setSkipped(left ?? []));
  } });
  const merged = props.heading !== false;
  const bulk = props.selection === undefined ? null : <BulkHeader selection={props.selection}
    trash={props.trash ?? false} allowEmpty={props.query.trim() === ''}
    more={canImport ? [{ icon: 'upload', label: '导入…', onSelect: picker.open }] : []}
    items={(props.notes ?? []).map((note) => ({ kind: 'note', id: note.id, title: note.title || '未命名' }))} />;
  return (
    <div className="note-list" ref={ref} onScroll={onScroll} hidden={props.hidden}>
      <div className="note-list-head">
        {merged ? null : bulk}
        {props.feedback && props.selection !== undefined ? <BulkFeedback selection={props.selection} /> : null}
        {canImport ? picker.input : null}
        {merged && props.selection?.active ? bulk : null}
        {props.heading === false || props.selection?.active ? null : <div className="note-list-heading">
          <div className="note-list-title">
            {props.onFolders === undefined ? <h2>{props.collectionLabel ?? '全部'}</h2> : (
              <button type="button" className="note-collection-toggle" aria-label="选择文件夹"
                aria-haspopup="dialog" aria-expanded={props.foldersOpen}
                onClick={(event) => props.onFolders?.(event.currentTarget)}>
                <Icon name="folder" />
                <span>{props.collectionLabel ?? '全部'}</span>
                <Icon name="chevron-down" size={14} />
              </button>
            )}
            {props.notes === null ? null : <span className="note-list-count" aria-label={`${props.notes.length} 篇`}>
              {props.notes.length}
            </span>}
          </div>
          {merged ? <div className="note-list-tools">{props.tools}{bulk}{props.trail}</div> : null}
        </div>}
        {props.selection?.active ? null : <SearchField className="note-search" label="搜索笔记" placeholder="搜索"
          value={props.query} onChange={props.onQuery} />}
        <SkippedFiles files={skipped} onClose={() => setSkipped([])} />
      </div>
      {props.error === null ? null : (
        <p className="block-empty is-error" role="alert">
          {props.error}
          {props.onRetry === undefined ? null : <button type="button" className="text-button"
            onClick={props.onRetry}>再读一次列表</button>}
        </p>
      )}
      {props.notes === null && props.error === null ? <PageLoading dense /> : null}
      {props.notes !== null && props.notes.length === 0 ? <div className="note-list-empty">
        <p className="block-empty">{props.query.trim() !== '' ? `没找到「${props.query.trim()}」。`
          : props.trash === true ? '最近删除里没有笔记。' : '还没有笔记。'}</p>
        {props.query.trim() === '' && props.trash !== true && props.onCreate !== undefined
          ? <button type="button" className="secondary-button" onClick={props.onCreate}>
            <Icon name="plus" size={14} />新建笔记</button> : null}
      </div> : null}
      {groupByDay(props.notes ?? [], now).map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3 className="note-group">{group.label}</h3>
          <ul className="note-rows">
            {group.notes.map((note) => (
              <li key={note.id} className="note-list-item" data-bulk={props.selection?.active} data-context-row=""
                data-selected={props.selection?.checked({ kind: 'note', id: note.id })}>
                {props.selection === undefined ? null : <BulkCheck selection={props.selection}
                  item={{ kind: 'note', id: note.id, title: note.title || '未命名' }} />}
                <button
                  type="button"
                  className="note-row"
                  aria-current={!props.selection?.active && note.id === props.selectedId ? 'true' : undefined}
                  onClick={(event) => props.selection?.active
                    ? props.selection.toggle({ kind: 'note', id: note.id, title: note.title || '未命名' }, event.shiftKey)
                    : props.onOpen(note.id)}
                >
                  <span className="note-row-title">
                    {note.title === '' ? '未命名' : note.title}
                    {isAiNote(note) ? <AiMark /> : null}
                  </span>
                  {note.preview === '' ? null : <span className="note-row-preview">{note.preview}</span>}
                  <span className="note-row-meta">
                    <span className="note-row-time text-meta">{timeText(note.updatedAt, now)}</span>
                    {props.showFolder && note.folder !== '笔记' ? (
                      <span className="note-row-folder">{note.folder}</span>
                    ) : null}
                    {(note.mergedCount ?? 0) > 0 ? <span>合并 {note.mergedCount}</span> : null}
                  </span>
                </button>
                {props.selection?.active ? null : <NoteActions note={note} label={`《${note.title || '未命名'}》的操作`}
                  exportNote={props.trash === true ? undefined : () => void exportNoteFiles(api, [note.id])}
                  remove={() => void removeNoteWithUndo(api, noteOps, note)} />}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {props.selection === undefined ? null : <BulkBar selection={props.selection} trash={props.trash ?? false}
        folders={props.folders ?? []}
        onExport={(items) => void exportNoteFiles(api, items.map((item) => item.id))} />}
    </div>
  );
}
