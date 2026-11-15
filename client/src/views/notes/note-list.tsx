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
import { deleteNote } from './note-delete.ts';
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
  /** 点文件夹名：手机上开文件夹抽屉，电脑上在它下面出文件夹列表（给按钮自己，好贴着它）。 */
  onFolders?: ((button: HTMLElement) => void) | undefined;
  /** 文件夹列表开着（电脑上的弹层）。 */
  foldersOpen?: boolean;
  onRetry?: () => void;
  /** 手机上文件夹名已经在页头（设计稿 Phone-Notes），列表里不再写一遍。 */
  heading?: boolean;
  /** 文件夹名这一行右边的按钮（新建）；电脑上才有。 */
  tools?: ReactNode;
  /** 这一行最右边（收起第二栏，网页版才有）。 */
  trail?: ReactNode;
  /** 还没有笔记时空状态里的「新建笔记」（11-15 空的一种样子）。 */
  onCreate?: () => void;
}

export function NoteList(props: NoteListProps): ReactNode {
  // 列表读到之前只有「正在读…」，位置等列表到了再恢复。
  const { ref, onScroll } = useRememberedScroll<HTMLDivElement>('notes:list', props.notes !== null);
  const now = new Date();
  const api = useApi();
  const { noteOps } = useClientState();
  // 电脑上（有文件夹名这一行）工具并进这一行；手机上文件夹名在页头，「更多操作」照旧自己一行。
  const merged = props.heading !== false;
  const bulk = props.selection === undefined ? null : <BulkHeader selection={props.selection}
    trash={props.trash ?? false} allowEmpty={props.query.trim() === ''}
    items={(props.notes ?? []).map((note) => ({ kind: 'note', id: note.id, title: note.title || '未命名' }))} />;
  return (
    <div className="note-list" ref={ref} onScroll={onScroll} hidden={props.hidden}>
      <div className="note-list-head">
        {merged ? null : bulk}
        {props.feedback && props.selection !== undefined ? <BulkFeedback selection={props.selection} /> : null}
        {/* 11-13 Aaron 的示意：页头那条大标题去掉，「收起列表」「新建」和列表的「更多操作」都放到文件夹名这一行。 */}
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
                  <span className="note-row-title">{note.private ? <span aria-label="私密">
                    <Icon name="lock" size={14} />
                  </span> : null}
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
                  remove={() => void deleteNote(api, noteOps, note.id)} />}
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
