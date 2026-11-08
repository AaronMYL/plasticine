// 资料库首页（#/library；旧地址 #/books/space 同一页）：不属于订阅的空间，一行一个，最近改过的在前；行尾 ⋯ 改名 / 删除，
// 改名在这一行原处改。手机上没有第二栏，这一页顶上再列「订阅」、底下一行「最近删除」，从这里都能走到。

import { useState, type ReactNode } from 'react';
import type { SpaceListItem } from '../../api/shared.ts';
import { useLibraryData } from '../../shell/columns/library-column.tsx';
import { useLibraryTrash, useSubscriptionList } from '../../shell/columns/library-subscriptions.tsx';
import { spaceLook, subscriptionLook } from '../../shell/columns/space-look.ts';
import { HueTile } from '../../shell/hue.tsx';
import { Icon } from '../../shell/icons.tsx';
import { LIBRARY_TRASH, subscriptionRoute } from '../../shell/library-routes.ts';
import { PageHeader } from '../../shell/page-header.tsx';
import { RenameField } from '../../shell/rename-field.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import type { Route } from '../../shell/routes.ts';
import { spaceRoute } from '../spaces/space-links.ts';
import { useDeleteConfirm, useSpaceActions } from './library-actions.tsx';
import './library.css';

interface RowProps {
  space: SpaceListItem;
  navigate: (route: Route) => void;
  onDelete: (space: SpaceListItem) => void;
}

function SpaceRow({ space, navigate, onDelete }: RowProps): ReactNode {
  const actions = useSpaceActions();
  const [renaming, setRenaming] = useState(false);
  const look = spaceLook(space);
  return (
    <li className="lib-row">
      {renaming ? (
        <div className="spaces-row">
          <HueTile hue={look.hue} icon={look.icon} />
          <RenameField value={space.title} label={`「${space.title}」的新名字`}
            onSave={(title) => actions.rename(space.id, title)} onDone={() => setRenaming(false)} />
        </div>
      ) : (
        <button type="button" className="spaces-row" onClick={() => navigate(spaceRoute(space.id))}>
          <HueTile hue={look.hue} icon={look.icon} />
          <span className="spaces-row-title">{space.title}</span>
        </button>
      )}
      <RevealMore label={`「${space.title}」的更多操作`} actions={renaming ? [] : [
        { icon: 'edit', label: '改名', onSelect: () => setRenaming(true) },
        { icon: 'trash', label: '删除', danger: true, onSelect: () => onDelete(space) },
      ]} />
    </li>
  );
}

/** 手机上的「订阅」一组和「最近删除」那一行（电脑上它们在第二栏）。 */
function PhoneExtras({ navigate, children }: { navigate: (route: Route) => void; children: ReactNode }): ReactNode {
  const { subscriptions } = useSubscriptionList();
  const { trash } = useLibraryTrash();
  const count = trash?.items.length ?? 0;
  return (
    <>
      {subscriptions === null || subscriptions.length === 0 ? null : <section aria-label="订阅">
        <h2 className="lib-label">订阅</h2>
        <ul className="spaces-rows">
          {subscriptions.map((item) => {
            const look = subscriptionLook(item.kind);
            return (
              <li key={item.id}>
                <button type="button" className="spaces-row" onClick={() => navigate(subscriptionRoute(item.id))}>
                  <HueTile hue={look.hue} icon={look.icon} />
                  <span className="spaces-row-title">{item.title}</span>
                  {item.issueCount === 0 ? null : <span className="lib-count">{item.issueCount}</span>}
                  <Icon name="chevron-right" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>}
      {children}
      <ul className="spaces-rows lib-trash-link">
        <li>
          <button type="button" className="spaces-row" onClick={() => navigate(LIBRARY_TRASH)}>
            <span className="lib-trash-icon"><Icon name="trash" size={16} /></span>
            <span className="spaces-row-title">最近删除</span>
            {count === 0 ? null : <span className="lib-count">{count}</span>}
            <Icon name="chevron-right" size={14} />
          </button>
        </li>
      </ul>
    </>
  );
}

export function LibraryHome({ phone, navigate }: { phone: boolean; navigate: (route: Route) => void }): ReactNode {
  const { spaces, error } = useLibraryData();
  const actions = useSpaceActions();
  const confirm = useDeleteConfirm();
  const remove = (space: SpaceListItem): void => confirm.ask(space.title, () => actions.remove(space.id));
  const list = (
    <section aria-label="空间">
      {phone ? <h2 className="lib-label">空间</h2> : null}
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      {spaces === null && error === null ? <p className="block-empty" role="status">正在读…</p> : null}
      {spaces !== null && spaces.length === 0 ? <p className="block-empty">还没有空间。</p> : null}
      {spaces === null || spaces.length === 0 ? null : (
        <ul className="spaces-rows">
          {spaces.map((space) => <SpaceRow key={space.id} space={space} navigate={navigate} onDelete={remove} />)}
        </ul>
      )}
    </section>
  );
  return (
    <div className="page lib-page spaces-list">
      <PageHeader title={phone ? '资料库' : '空间'} />
      {phone ? <PhoneExtras navigate={navigate}>{list}</PhoneExtras> : list}
      {confirm.dialog}
    </div>
  );
}
