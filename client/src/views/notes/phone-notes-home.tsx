// 手机上的笔记首层（2026-11-05 设计稿 Phone-Notes）：一张圆角卡列文件夹（图标 · 名字 · 篇数 · ›），下面「最近」几篇
// （标题 + ✦ · 时间 + 第一句 · 右边文件夹）。点文件夹进那个文件夹的列表，点一篇直接打开；新建在页头查找后面。

import type { ReactNode } from 'react';
import type { NoteMetaView } from '../../api/shared.ts';
import { useTimeZone } from '../../live.tsx';
import { AiMark } from '../../shell/glyph.tsx';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { isAiFolder, isAiNote } from './ai-folder.ts';
import { useNoteFolders, type NoteCollection } from './note-folders.tsx';
import { when } from './note-time.ts';
import { useNoteList } from './use-notes.ts';
import './phone-notes.css';

/** 「最近」列几篇。 */
const RECENT_ROWS = 5;

interface FolderRow {
  label: string;
  count: number;
  icon: IconName;
  target: NoteCollection;
}

export function recentNotes(notes: readonly NoteMetaView[] | null): NoteMetaView[] {
  return [...(notes ?? [])].filter((note) => note.deletedAt === null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, RECENT_ROWS);
}

const ALL: NoteCollection = { kind: 'all' };

export function PhoneNotesHome({ onCollection, onOpen }: {
  onCollection: (collection: NoteCollection) => void;
  onOpen: (id: string) => void;
}): ReactNode {
  const timeZone = useTimeZone();
  const { notes, error, retry } = useNoteList('', ALL);
  const { folders } = useNoteFolders();
  const now = new Date();
  const named = folders?.folders ?? [];
  const ai = named.filter((folder) => isAiFolder(folder.name));
  const rest = named.filter((folder) => !isAiFolder(folder.name));
  const rows: FolderRow[] = [
    { label: '全部', count: folders?.allCount ?? 0, icon: 'notes', target: { kind: 'all' } },
    ...[...rest.slice(0, 1), ...ai, ...rest.slice(1)].map((folder) => ({ label: folder.name, count: folder.count,
      icon: isAiFolder(folder.name) ? 'sparkle' as const : 'folder' as const,
      target: { kind: 'folder' as const, name: folder.name } })),
    ...(folders !== null && folders.deletedCount > 0 ? [{ label: '最近删除', count: folders.deletedCount,
      icon: 'trash' as const, target: { kind: 'deleted' as const } }] : []),
  ];
  const recent = recentNotes(notes);
  return (
    <div className="phone-notes">
      <ul className="phone-folders" aria-label="笔记文件夹">
        {rows.map((row) => (
          <li key={row.label}>
            <button type="button" className="phone-folder" data-ai={row.icon === 'sparkle'}
              aria-label={`${row.label} ${row.count}`} onClick={() => onCollection(row.target)}>
              <Icon name={row.icon} size={17} />
              <span className="phone-folder-name">{row.label}</span>
              <span className="phone-folder-count">{row.count}</span>
              <Icon name="chevron-right" size={15} />
            </button>
          </li>
        ))}
      </ul>
      {error === null || notes !== null ? null : (
        <p className="block-empty is-error" role="alert">
          {error}{' '}<button type="button" className="text-button" onClick={retry}>重新读取列表</button>
        </p>
      )}
      {recent.length === 0 ? null : (
        <section className="phone-recent" aria-labelledby="phone-recent-title">
          <h2 id="phone-recent-title" className="phone-recent-title">最近</h2>
          <ul className="phone-recent-rows">
            {recent.map((note) => (
              <li key={note.id}>
                <button type="button" className="phone-recent-row" onClick={() => onOpen(note.id)}>
                  <span className="phone-recent-head">
                    <span className="phone-recent-name">{note.title || '未命名'}</span>
                    {isAiNote(note) ? <AiMark /> : null}
                  </span>
                  <span className="phone-recent-line">
                    <time className="phone-recent-time" dateTime={note.updatedAt}>
                      {when(note.updatedAt, now, timeZone)}
                    </time>
                    <span className="phone-recent-preview">{note.preview}</span>
                    <span className="phone-recent-folder">{note.folder}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
