// 空间的列表（#/books/space）：手机「更多 · 空间」打开它（电脑上空间列在资料库的第二栏，这一页同样能开）。
// 一行一个：类别色图标块、标题、行尾 ›，最近改过的在前。数据和资料库第二栏同一份（GET /v2/spaces）。

import type { ReactNode } from 'react';
import { useLibraryData, spaceLook } from '../../shell/columns/library-column.tsx';
import { HueTile } from '../../shell/hue.tsx';
import { Icon } from '../../shell/icons.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import type { Route } from '../../shell/routes.ts';
import './spaces.css';

export function SpacesList({ navigate }: { navigate: (route: Route) => void }): ReactNode {
  const { spaces, error } = useLibraryData();
  return (
    <div className="page spaces-list">
      <PageHeader title="空间" />
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      {spaces === null && error === null ? <p className="block-empty">正在读…</p> : null}
      {spaces !== null && spaces.length === 0 ? <p className="block-empty">还没有空间。</p> : null}
      <ul className="spaces-rows">
        {(spaces ?? []).map((space) => {
          const look = spaceLook(space);
          return (
            <li key={space.id}>
              <button type="button" className="spaces-row" onClick={() => navigate({ view: 'books', noteId: null,
                bookId: null, spaceId: space.id })}>
                <HueTile hue={look.hue} icon={look.icon} />
                <span className="spaces-row-title">{space.title}</span>
                <Icon name="chevron-right" size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
