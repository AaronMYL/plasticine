// 资料库首页（#/library；旧地址 #/books/space 同一页）。第 8 批第 6 条（设计稿 Library-Spaces / Phone-Library，11-09）：
// 空间是整页网页，第一屏是缩略图卡片——「最近」三张（手机上一排横滑），「全部」四列（手机两列）；卡片下面是标题、
// 「报告 / 来信 · 时间」和 ⋯（改名、删除）。改名在卡片原处改；删除先问，删了进「最近删除」。
// 手机上没有第二栏，「全部」下面再列「订阅」和「最近删除」，从这里都能走到。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { SpaceListItem } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useLibraryTrash, useSubscriptionList } from '../../shell/columns/library-subscriptions.tsx';
import { subscriptionLook } from '../../shell/columns/space-look.ts';
import { HueTile } from '../../shell/hue.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { LIBRARY_TRASH, subscriptionRoute } from '../../shell/library-routes.ts';
import { PageHeader } from '../../shell/page-header.tsx';
import { RenameField } from '../../shell/rename-field.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { routeHash, type Route } from '../../shell/routes.ts';
import { useInTitlebar } from '../../shell/titlebar.tsx';
import { spaceRoute } from '../spaces/space-links.ts';
import { SpaceThumb } from '../spaces/space-thumb.tsx';
import { genreLabel, spaceWhen } from '../spaces/space-time.ts';
import { useDeleteConfirm, useSpaceActions } from './library-actions.tsx';
import { useLibraryRevision } from './library-signal.ts';
import './library.css';
import './library-grid.css';

/** 「最近」放几张（设计稿：电脑一排三张）。 */
const RECENT_COUNT = 3;

/** 资料库首页要全部的空间（订阅的各期也在「全部」里）；资料库变了、重连了重读。 */
function useAllSpaces(): { spaces: SpaceListItem[] | null; error: string | null } {
  const api = useApi();
  const live = useLive();
  const revision = useLibraryRevision();
  const [round, setRound] = useState(0);
  const [state, setState] = useState<{ spaces: SpaceListItem[] | null; error: string | null }>(
    { spaces: null, error: null });
  useEffect(() => live.hub.on((event) => {
    if (event.type === 'resync') setRound((value) => value + 1);
  }), [live.hub]);
  useEffect(() => {
    const controller = new AbortController();
    api.spaces.list(controller.signal).then((result) => setState({ spaces: result.spaces, error: null }),
      (cause: unknown) => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, error: errorText(cause) }));
      });
    return () => controller.abort();
  }, [api, round, revision]);
  return state;
}

interface CardProps {
  space: SpaceListItem;
  now: Date;
  onDelete: (space: SpaceListItem) => void;
}

function SpaceCard({ space, now, onDelete }: CardProps): ReactNode {
  const actions = useSpaceActions();
  const [renaming, setRenaming] = useState(false);
  const meta = `${genreLabel(space.genre)} · ${spaceWhen(space.updatedAt, now)}`;
  return (
    <li className="lib-card" data-genre={space.genre ?? 'legacy'}>
      <a className="lib-card-link" href={routeHash(spaceRoute(space.id))} aria-label={space.title}
        tabIndex={renaming ? -1 : undefined}>
        <SpaceThumb spaceId={space.id} version={space.version} />
      </a>
      {renaming ? (
        <RenameField value={space.title} label={`「${space.title}」的新名字`}
          onSave={(title) => actions.rename(space.id, title)} onDone={() => setRenaming(false)} />
      ) : <a className="lib-card-title" href={routeHash(spaceRoute(space.id))} tabIndex={-1} aria-hidden="true">
        {space.title}</a>}
      <div className="lib-card-meta">
        <span className="text-meta">{meta}</span>
        <RevealMore label={`「${space.title}」的更多操作`} actions={renaming ? [] : [
          { icon: 'edit', label: '改名', onSelect: () => setRenaming(true) },
          { icon: 'trash', label: '删除', danger: true, onSelect: () => onDelete(space) },
        ]} />
      </div>
    </li>
  );
}

/** 手机上的「订阅」一组和「最近删除」那一行（电脑上它们在第二栏）。 */
function PhoneExtras({ navigate }: { navigate: (route: Route) => void }): ReactNode {
  const { subscriptions } = useSubscriptionList();
  const { trash } = useLibraryTrash();
  const count = trash?.items.length ?? 0;
  return (
    <>
      {subscriptions === null || subscriptions.length === 0 ? null : <section aria-label="订阅" className="lib-grid-sec">
        <h2 className="lib-grid-head">订阅</h2>
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
  const { spaces, error } = useAllSpaces();
  const actions = useSpaceActions();
  const confirm = useDeleteConfirm();
  const titled = useInTitlebar();
  const { shellPrefs } = useClientState();
  const now = new Date();
  const remove = (space: SpaceListItem): void => confirm.ask(space.title, () => actions.remove(space.id));
  const cards = (list: readonly SpaceListItem[]): ReactNode[] => list.map((space) => (
    <SpaceCard key={space.id} space={space} now={now} onDelete={remove} />));
  const ask = <IconButton icon="plus" label="新空间：跟 Plasticine 说"
    onClick={() => shellPrefs.setPhoneChatOpen(true)} />;
  return (
    <div className="page lib-page lib-grid-page" data-phone={phone}>
      {titled ? null : <PageHeader title="资料库" phoneSearch={false} phoneTools={ask} />}
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      {spaces === null && error === null ? <p className="block-empty" role="status">正在读…</p> : null}
      {spaces !== null && spaces.length === 0 ? <p className="block-empty">还没有空间。</p> : null}
      {spaces === null || spaces.length === 0 ? null : <>
        <section aria-label="最近" className="lib-grid-sec">
          <h2 className="lib-grid-head">最近</h2>
          <ul className="lib-cards lib-recent">{cards(spaces.slice(0, RECENT_COUNT))}</ul>
        </section>
        <section aria-label="全部" className="lib-grid-sec">
          <h2 className="lib-grid-head">全部<span className="lib-grid-count">{spaces.length}</span></h2>
          <ul className="lib-cards lib-all">{cards(spaces)}</ul>
        </section>
      </>}
      {phone ? <PhoneExtras navigate={navigate} /> : null}
      {confirm.dialog}
    </div>
  );
}
