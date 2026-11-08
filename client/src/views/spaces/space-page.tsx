// 空间页（《优化清单》第 6 条，设计稿 Library-Space）：Plasticine 写的报告、周报、核查、整理稿都在这里读和改。
// 从上到下：顶部一行出处（✦ 订阅 · 名字，点了去订阅页）和编辑、⋯（改名 / 删除，11-08：改名在大标题处原处改，删了进
// 「最近删除」）；一小行期号日期；结论大标题；一排数字卡；正文（小节、图表、
// 图片、引用）；出处。右侧目录。Plasticine 刚改过这一期时，页底一条「这一期改好了：…… 以后都这样 / 撤销」。

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SpaceView } from '../../api/shared.ts';
import { AiMark, StatusGlyph } from '../../shell/glyph.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { LIBRARY_HOME, subscriptionRoute } from '../../shell/library-routes.ts';
import { RenameField } from '../../shell/rename-field.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { TitlebarActions, TitlebarTitle, useInTitlebar } from '../../shell/titlebar.tsx';
import { useDeleteConfirm, useSpaceActions } from '../library/library-actions.tsx';
import { useRead } from '../memory/use-read.ts';
import { SpaceBlocks, SpaceStats } from './space-blocks.tsx';
import { SpaceEditor } from './space-editor.tsx';
import { SpaceToc } from './space-toc.tsx';
import { SubscriptionSheet } from './subscription-sheet.tsx';
import { spaceRoute } from './space-links.ts';
import { markSpaceSeen } from './space-seen.ts';
import type { Route } from '../../shell/routes.ts';
import './spaces.css';

export interface SpacePageProps {
  spaceId: string;
  phone: boolean;
  navigate: (route: Route) => void;
}

function Crumb({ space, onOpen }: { space: SpaceView; onOpen: () => void }): ReactNode {
  if (space.subscription !== null) {
    return <button type="button" className="space-crumb text-meta" onClick={onOpen}>
      <AiMark />订阅 · {space.subscription.title}</button>;
  }
  return <span className="space-crumb text-meta">{space.author === 'ai' ? <AiMark /> : null}空间</span>;
}

/** 页底那一条：Plasticine 改好了这一期。「以后都这样」写进订阅设置；「撤销」恢复上一版。 */
function ChangeToast({ space, onChanged }: { space: SpaceView; onChanged: (next: SpaceView | null) => void }):
  ReactNode {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const change = space.lastChange;
  if (change === null || change.adopted || kept) {
    return null;
  }
  const act = (work: () => Promise<SpaceView | null>): void => {
    setBusy(true);
    setError(null);
    void work().then(onChanged, (cause: unknown) => setError(errorText(cause))).finally(() => setBusy(false));
  };
  const adopt = (): void => act(async () => {
    const subscription = space.subscription;
    if (subscription === null) {
      return null;
    }
    await api.subscriptions.adoptRule(subscription.id, { requestId: createRequestId(), version: subscription.version,
      spaceId: space.id, spaceVersion: change.version });
    return null;
  });
  const undo = (): void => act(() => api.spaces.undo(space.id, { requestId: createRequestId(),
    version: space.version }));
  return (
    <div className="space-toast" role="status">
      <StatusGlyph status="done" label="改好了" />
      <span className="grow">{error ?? `这一期改好了：${change.change}`}</span>
      {change.rule !== null && space.subscription !== null ? (
        <button type="button" className="secondary-button space-toast-button" disabled={busy} onClick={adopt}
          data-tip={`以后每期：${change.rule}`}>以后都这样</button>
      ) : null}
      <button type="button" className="text-button text-button-quiet" disabled={busy} onClick={undo}>撤销</button>
      <IconButton icon="close" label="收起" onClick={() => setKept(true)} />
    </div>
  );
}

export function SpacePage({ spaceId, phone, navigate }: SpacePageProps): ReactNode {
  const api = useApi();
  const read = useCallback((signal: AbortSignal) => api.spaces.get(spaceId, signal), [api, spaceId]);
  const { value, error, reload } = useRead(read);
  const [saved, setSaved] = useState<SpaceView | null>(null);
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const actions = useSpaceActions();
  const confirm = useDeleteConfirm();
  const scroller = useRef<HTMLDivElement>(null);
  const titled = useInTitlebar();
  const space = saved !== null && saved.version >= (value?.version ?? 0) ? saved : value;
  // 打开过就算看过这一期：信息流第二栏「订阅」那一行的新一期点收掉。
  useEffect(() => {
    if (value !== null) markSpaceSeen(value.id);
  }, [value?.id]);
  if (space === null) {
    return <div className="page space-page">
      {error === null ? <p className="block-empty" role="status">正在读…</p>
        : <p className="block-empty is-error" role="alert">{error}{' '}
          <button type="button" className="text-button" onClick={reload}>重新读取</button></p>}
    </div>;
  }
  const changed = (next: SpaceView | null): void => {
    if (next === null) {
      setSaved(null);
      reload();
    } else {
      setSaved(next);
    }
  };
  // 桌面客户端里空间名写进标题栏、编辑 / 订阅设置 / ⋯ 放进标题栏右边（11-08），主区不再画这条顶栏；网页版仍在页头。
  const tools = <>
    {editing ? null : <IconButton icon="edit" label="编辑" onClick={() => setEditing(true)} />}
    {space.subscription === null ? null : (
      <IconButton icon="sliders" label="订阅设置" aria-haspopup="dialog" onClick={() => setSheet(true)} />
    )}
    <RevealMore label={`「${space.title}」的更多操作`} actions={editing ? [] : [
      { icon: 'edit', label: '改名', onSelect: () => setRenaming(true) },
      { icon: 'trash', label: '删除', danger: true, onSelect: () => confirm.ask(space.title,
        () => actions.remove(space.id),
        () => navigate(space.subscription === null ? LIBRARY_HOME : subscriptionRoute(space.subscription.id))) },
    ]} />
  </>;
  return (
    <div className="page page-fill space-page" data-phone={phone}>
      {titled ? <><TitlebarTitle text={space.title} /><TitlebarActions>{tools}</TitlebarActions></> : (
        <header className="space-top">
          <Crumb space={space} onOpen={() => {
            if (space.subscription !== null) navigate(subscriptionRoute(space.subscription.id));
          }} />
          <span className="grow" />
          {tools}
        </header>
      )}
      {confirm.dialog}
      <div className="space-scroll" ref={scroller}>
        <article className="space-article" aria-label={space.title}>
          {editing ? <SpaceEditor space={space} onCancel={() => setEditing(false)} onSaved={(next) => {
            setSaved(next);
            setEditing(false);
          }} /> : <>
            {space.doc.kicker === undefined ? null : <p className="text-meta space-kicker">{space.doc.kicker}</p>}
            {renaming ? <h1 className="space-headline">
              <RenameField value={space.title} label={`「${space.title}」的新名字`}
                onSave={(title) => actions.rename(space.id, title).then(() => {
                  setSaved(null);
                  reload();
                })} onDone={() => setRenaming(false)} />
            </h1> : <h1 className="space-headline">{space.doc.headline ?? space.title}</h1>}
            <SpaceStats stats={space.doc.stats} />
            <SpaceBlocks doc={space.doc} />
          </>}
        </article>
        {phone || editing ? null : <SpaceToc doc={space.doc} scroller={scroller} />}
      </div>
      {editing ? null : <ChangeToast key={`${space.id}:${space.version}`} space={space} onChanged={changed} />}
      {space.subscription === null ? null : (
        <SubscriptionSheet open={sheet} subscriptionId={space.subscription.id} phone={phone}
          onClose={() => {
            setSheet(false);
            reload();
          }}
          onOpenIssue={(id) => {
            setSheet(false);
            navigate(spaceRoute(id));
          }} />
      )}
    </div>
  );
}
