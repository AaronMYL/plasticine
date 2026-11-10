import { BulkHeader, BulkCheck, BulkBar, BulkFeedback } from '../bulk/bulk-controls.tsx';
import type { BulkSelection } from '../bulk/use-bulk-selection.ts';
// 笔记列表：搜索 + 按「置顶 / 今天 / 昨天 / 前 7 天 / 年月」分组，每条是标题、时间、预览。

import { AiMark } from '../../shell/glyph.tsx';
import { isAiNote } from './ai-folder.ts';
import type { ReactNode } from 'react';
import type { NoteMetaView } from '../../api/types.ts';
import { Icon } from '../../shell/icons.tsx';
import { useRememberedScroll } from '../../state/use-remembered-scroll.ts';
import { NoteActions } from './note-actions.tsx';
import { groupByDay, when } from './note-time.ts';

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
  onFolders?: (() => void) | undefined;
  onRetry?: () => void;
  /** 手机上文件夹名已经在页头（设计稿 Phone-Notes），列表里不再写一遍。 */
  heading?: boolean;
}

export function NoteList(props: NoteListProps): ReactNode {
  // 列表读到之前只有「正在读…」，位置等列表到了再恢复。
  const { ref, onScroll } = useRememberedScroll<HTMLDivElement>('notes:list', props.notes !== null);
  const now = new Date();
  return (
    <div className="note-list" ref={ref} onScroll={onScroll} hidden={props.hidden}>
      <div className="note-list-head">
        {props.selection === undefined ? null : <BulkHeader selection={props.selection} trash={props.trash ?? false}
          allowEmpty={props.query.trim() === ''}
          items={(props.notes ?? []).map((note) => ({ kind: 'note', id: note.id, title: note.title || '未命名' }))} />}
        {props.feedback && props.selection !== undefined ? <BulkFeedback selection={props.selection} /> : null}
        {props.heading === false || props.selection?.active ? null : <div className="note-list-heading">
          {props.onFolders === undefined ? <h2 title={props.collectionLabel}>{props.collectionLabel ?? '全部'}</h2> : (
            <button type="button" className="note-collection-toggle" aria-label="选择文件夹"
              title={props.collectionLabel} onClick={props.onFolders}>
              <Icon name="folder" />
              <span>{props.collectionLabel ?? '全部'}</span>
              <Icon name="chevron-down" size={14} />
            </button>
          )}
          {props.notes === null ? null : <span className="note-list-count" aria-label={`${props.notes.length} 篇`}>
            {props.notes.length}
          </span>}
        </div>}
        {props.selection?.active ? null : <div className="note-search">
          <Icon name="search" size={15} />
          <input className="search-input" type="search" aria-label="搜索笔记" placeholder="搜索"
            value={props.query} onChange={(event) => props.onQuery(event.target.value)} />
        </div>}
      </div>
      {props.error === null ? null : (
        <p className="block-empty is-error" role="alert">
          {props.error}
          {props.onRetry === undefined ? null : <button type="button" className="text-button"
            onClick={props.onRetry}>重新读取列表</button>}
        </p>
      )}
      {props.notes === null && props.error === null ? <p className="block-empty">正在读…</p> : null}
      {props.notes !== null && props.notes.length === 0 ? (
        <p className="block-empty">{props.query === '' ? '还没有笔记。' : '没有找到。'}</p>
      ) : null}
      {groupByDay(props.notes ?? [], now).map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3 className="note-group">{group.label}</h3>
          <ul className="note-rows">
            {group.notes.map((note) => (
              <li key={note.id} className="note-list-item" data-bulk={props.selection?.active}
                data-selected={props.selection?.checked({ kind: 'note', id: note.id })}>
                {props.selection === undefined ? null : <BulkCheck selection={props.selection}
                  item={{ kind: 'note', id: note.id, title: note.title || '未命名' }} />}
                <button
                  type="button"
                  className="note-row"
                  title={note.title === '' ? '未命名' : note.title}
                  aria-current={!props.selection?.active && note.id === props.selectedId ? 'true' : undefined}
                  onClick={(event) => props.selection?.active
                    ? props.selection.toggle({ kind: 'note', id: note.id, title: note.title || '未命名' }, event.shiftKey)
                    : props.onOpen(note.id)}
                >
                  <span className="note-row-title">{note.private ? <span aria-label="私密">
                    <Icon name="lock" size={13} />
                  </span> : null}
                    {note.title === '' ? '未命名' : note.title}
                    {isAiNote(note) ? <AiMark /> : null}
                  </span>
                  {note.preview === '' ? null : <span className="note-row-preview">{note.preview}</span>}
                  <span className="note-row-meta">
                    <span className="note-row-time text-meta">{when(note.updatedAt, now)}</span>
                    {props.showFolder && note.folder !== '笔记' ? (
                      <span className="note-row-folder" title={note.folder}>{note.folder}</span>
                    ) : null}
                    {(note.mergedCount ?? 0) > 0 ? <span>合并 {note.mergedCount}</span> : null}
                  </span>
                </button>
                {props.selection?.active ? null : <NoteActions note={note} label={`《${note.title || '未命名'}》的操作`} />}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {props.selection === undefined ? null : <BulkBar selection={props.selection} trash={props.trash ?? false}
        folders={props.folders ?? []} />}
    </div>
  );
}
