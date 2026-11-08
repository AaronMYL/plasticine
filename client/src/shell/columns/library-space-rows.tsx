// 资料库第二栏「空间」一组的行（2026-11-08，设计稿 Library-Menu / Library-Rename / Library-Delete）：悬停（键盘聚焦、
// 触屏常显）出行尾 ⋯：改名 / 打开 / 删除。改名在这一行原处改（回车存、Esc 取消、点到别处也存）；删除先问，删了进
// 「最近删除」，正开着的那个空间被删就回资料库首页。

import { useState, type ReactNode } from 'react';
import type { SpaceListItem } from '../../api/shared.ts';
import { useDeleteConfirm, useSpaceActions } from '../../views/library/library-actions.tsx';
import { HueTile } from '../hue.tsx';
import { LIBRARY_HOME } from '../library-routes.ts';
import { RenameField } from '../rename-field.tsx';
import { RevealMore } from '../reveal-more.tsx';
import type { Route } from '../routes.ts';
import { ColumnLink } from './column.tsx';
import { spaceLook } from './space-look.ts';
import './library-column.css';

function spaceRoute(id: string): Route {
  return { view: 'books', noteId: null, bookId: null, spaceId: id };
}

interface SpaceRowProps {
  space: SpaceListItem;
  current: boolean;
  navigate: (route: Route) => void;
  onDelete: (space: SpaceListItem) => void;
}

function SpaceRow({ space, current, navigate, onDelete }: SpaceRowProps): ReactNode {
  const actions = useSpaceActions();
  const [renaming, setRenaming] = useState(false);
  const look = spaceLook(space);
  const lead = <HueTile hue={look.hue} icon={look.icon} size={22} />;
  if (renaming) {
    return (
      <div className="column-item column-item-editing" aria-current={current ? 'page' : undefined}>
        <span className="column-item-lead">{lead}</span>
        <RenameField value={space.title} label={`「${space.title}」的新名字`}
          onSave={(title) => actions.rename(space.id, title)} onDone={() => setRenaming(false)} />
      </div>
    );
  }
  return (
    <div className="column-row">
      <ColumnLink route={spaceRoute(space.id)} current={current} navigate={navigate} lead={lead}>
        {space.title}
      </ColumnLink>
      <RevealMore label={`「${space.title}」的更多操作`} actions={[
        { icon: 'edit', label: '改名', onSelect: () => setRenaming(true) },
        { icon: 'external', label: '打开', onSelect: () => navigate(spaceRoute(space.id)) },
        { icon: 'trash', label: '删除', danger: true, onSelect: () => onDelete(space) },
      ]} />
    </div>
  );
}

export function SpaceRows({ spaces, current, navigate }: { spaces: readonly SpaceListItem[];
  current: string | null; navigate: (route: Route) => void }): ReactNode {
  const actions = useSpaceActions();
  const confirm = useDeleteConfirm();
  const remove = (space: SpaceListItem): void => confirm.ask(space.title, () => actions.remove(space.id), () => {
    if (current === space.id) navigate(LIBRARY_HOME);
  });
  return (
    <>
      {spaces.map((space) => (
        <SpaceRow key={space.id} space={space} current={current === space.id} navigate={navigate}
          onDelete={remove} />
      ))}
      {confirm.dialog}
    </>
  );
}
