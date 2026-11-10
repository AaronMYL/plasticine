// 「最近删除」（#/library/trash，2026-11-08 设计稿 Library-Trash）：删掉的空间、图书、文件混在一起，删的时间新的在前。
// 每行：类型图标 · 名字 · 类型 · 删除时间 · 「还原」。还原后那一行淡出收起，资料库各处跟着重读。没有永久删除。

import { useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { LibraryTrashItem, LibraryTrashKind } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { useLibraryTrash } from '../../shell/columns/library-subscriptions.tsx';
import { HueTile } from '../../shell/hue.tsx';
import { Icon } from '../../shell/icons.tsx';
import { exitKeyframes, MOTION, playThen } from '../../shell/motion.ts';
import { PageHeader } from '../../shell/page-header.tsx';
import { libraryChanged } from './library-signal.ts';

const KIND_LABELS: Readonly<Record<LibraryTrashKind, string>> = {
  space: '空间', book: '图书', file: '文件', folder: '文件夹',
};

function KindIcon({ kind }: { kind: LibraryTrashKind }): ReactNode {
  if (kind === 'space') return <HueTile hue="sky" icon="file" size={22} />;
  const icon = kind === 'book' ? 'books' : kind === 'folder' ? 'folder' : 'file';
  return <span className="lib-trash-icon"><Icon name={icon} size={16} /></span>;
}

/** 今天的写「今天 14:02」，别的写「11月6日」（按他所在的时区）。 */
export function deletedText(iso: string, now: Date, timeZone: string): string {
  const day = (date: Date): string => new Intl.DateTimeFormat('zh-CN', { timeZone, year: 'numeric', month: 'numeric',
    day: 'numeric' }).format(date);
  const at = new Date(iso);
  if (day(at) === day(now)) {
    const time = new Intl.DateTimeFormat('zh-CN', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(at);
    return `今天 ${time}`;
  }
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'numeric', day: 'numeric' }).formatToParts(at);
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('month')}月${value('day')}日`;
}

function keyOf(item: LibraryTrashItem): string {
  return `${item.kind}:${item.id}`;
}

function TrashRow({ item, now, onRestore, onGone }: { item: LibraryTrashItem; now: Date;
  onRestore: (item: LibraryTrashItem) => Promise<void>; onGone: () => void }): ReactNode {
  const timeZone = useTimeZone();
  const row = useRef<HTMLLIElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restore = (): void => {
    setBusy(true);
    setError(null);
    onRestore(item).then(() => {
      const element = row.current;
      playThen(element, exitKeyframes(element?.offsetHeight ?? 0), MOTION.base, onGone);
    }, (cause: unknown) => {
      setBusy(false);
      setError(errorText(cause));
    });
  };
  const label = KIND_LABELS[item.kind];
  return (
    <li ref={row} className="lib-trash-row">
      <KindIcon kind={item.kind} />
      <span className="lib-trash-name">
        <span className="lib-trash-title">{item.title}</span>
        {error === null ? null : <span className="lib-trash-error" role="alert">{error}</span>}
      </span>
      <span className="lib-trash-kind text-meta">{label}</span>
      <time className="lib-trash-time text-meta" dateTime={item.deletedAt}>{deletedText(item.deletedAt, now,
        timeZone)}</time>
      <button type="button" className="secondary-button button-small" disabled={busy}
        aria-label={`还原${label}「${item.title}」`} onClick={restore}>还原</button>
    </li>
  );
}

export function TrashPage(): ReactNode {
  const api = useApi();
  const { m5b } = useLive();
  const { trash, error } = useLibraryTrash();
  // 还原了、收起动画也播完的：先从这一页拿掉，再让资料库各处重读（重读回来它本来也不在了）。
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const now = new Date();
  const restore = async (item: LibraryTrashItem): Promise<void> => {
    const requestId = createRequestId();
    if (item.kind === 'space') {
      await api.spaces.restore(item.id, { requestId });
    } else if (item.kind === 'book') {
      await api.books.restore(item.id, requestId);
    } else {
      await api.files.restore({ requestId, id: item.id });
      // 文件页和它的回收各有一份缓存：还原了一起重读。
      void m5b.files.reset();
      void m5b.trash.reload();
    }
  };
  const items = (trash?.items ?? []).filter((item) => !gone.has(keyOf(item)));
  return (
    <div className="page lib-page lib-trash">
      <PageHeader title="最近删除" />
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      {trash === null && error === null ? <p className="block-empty" role="status">正在读…</p> : null}
      {trash !== null && items.length === 0 ? <p className="block-empty">没有删掉的东西。</p> : null}
      {items.length === 0 ? null : (
        <ul className="lib-trash-rows">
          {items.map((item) => <TrashRow key={keyOf(item)} item={item} now={now} onRestore={restore}
            onGone={() => {
              setGone((previous) => new Set(previous).add(keyOf(item)));
              libraryChanged();
            }} />)}
        </ul>
      )}
    </div>
  );
}
