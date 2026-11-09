// 空间页（《优化清单》第 6 条；第 8 批第 6 条 11-09 起是整页网页，设计稿 Report / Report-Edit / Letter / Phone-*）：
// Plasticine 写的报告和来信都在这里读和改。
// - 电脑：空间名在标题栏，右边是 space-tools.tsx 的那几样；整页是一个沙盒 iframe（space-frame.tsx），自己滚。
// - 网页版：同样的东西放在页头一行；手机：返回 + 那几样，不显示底栏（phone-bar.tsx 的 phoneFullPage）。
// - 修改两条路：跟 Plasticine 说（「让 Plasticine 改」把这一页引用进对话、打开对话框），或者点 ✎ 在页面上直接改字
//   （自动存，Esc 或「完成」收起，space-saver.ts）。
// - Plasticine 刚改过这一期时，页底一条「这一期改好了：…… 以后都这样 / 撤销」（space-toast.tsx）。
// 还没重写成网页的旧版式照旧显示（space-legacy.tsx），只读。

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { SpaceView } from '../../api/shared.ts';
import { AiMark } from '../../shell/glyph.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { LIBRARY_HOME, subscriptionRoute } from '../../shell/library-routes.ts';
import { RenameField } from '../../shell/rename-field.tsx';
import { TitlebarActions, TitlebarTitle, useInTitlebar } from '../../shell/titlebar.tsx';
import { useRoute } from '../../shell/use-route.ts';
import { useMention } from '../conversation/mention-button.tsx';
import { useDeleteConfirm, useSpaceActions } from '../library/library-actions.tsx';
import { FOCUS_COMPOSER_EVENT } from '../lines/line-composer.tsx';
import { useRead } from '../memory/use-read.ts';
import { SpaceFrame } from './space-frame.tsx';
import { LegacySpace } from './space-legacy.tsx';
import { spaceRoute } from './space-links.ts';
import { useSpaceSaver } from './space-saver.ts';
import { markSpaceSeen } from './space-seen.ts';
import { letterDate } from './space-time.ts';
import { ChangeToast } from './space-toast.tsx';
import { SpaceTools } from './space-tools.tsx';
import { SubscriptionSheet } from './subscription-sheet.tsx';
import type { Route } from '../../shell/routes.ts';
import './spaces.css';
import './space-frame.css';

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
  return <span className="space-crumb text-meta">{space.author === 'ai' ? <AiMark /> : null}
    {space.genre === 'letter' ? '来信' : '空间'}</span>;
}

/** 编辑时在页面外按 Esc 也收起（iframe 里的 Esc 由它自己交回来）。 */
function useEscape(on: boolean, close: () => void): void {
  useEffect(() => {
    if (!on) return undefined;
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [on, close]);
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
  const mention = useMention();
  const { canGoBack, goBack } = useRoute();
  const titled = useInTitlebar();
  const space = saved !== null && saved.version >= (value?.version ?? 0) ? saved : value;
  const saver = useSpaceSaver(space, setSaved);
  const stopEditing = useCallback(() => setEditing(false), []);
  useEscape(editing, stopEditing);
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
  const leave = (): void => navigate(space.subscription === null ? LIBRARY_HOME
    : subscriptionRoute(space.subscription.id));
  const ask = (): void => {
    mention({ type: 'space', id: space.id, version: space.version, label: space.title,
      text: space.genre === 'letter' ? `回信：《${space.title}》` : `改这一页：《${space.title}》` });
    requestAnimationFrame(() => window.dispatchEvent(new Event(FOCUS_COMPOSER_EVENT)));
  };
  const tools = <SpaceTools space={space} phone={phone} editing={editing} onAsk={ask} onEdit={setEditing}
    onRename={() => setRenaming(true)} onSettings={() => setSheet(true)}
    onDelete={() => confirm.ask(space.title, () => actions.remove(space.id), leave)} />;
  const back = (): void => (canGoBack ? goBack() : leave());
  let head: ReactNode;
  if (titled) {
    head = <><TitlebarTitle text={space.title} /><TitlebarActions>{tools}</TitlebarActions></>;
  } else if (phone) {
    head = <header className="space-phone-top">
      <IconButton icon="back" label="返回" onClick={back} />
      <span className="space-phone-title">{space.genre === 'letter' ? '' : space.title}</span>
      {tools}
    </header>;
  } else {
    head = <header className="space-top">
      <Crumb space={space} onOpen={() => {
        if (space.subscription !== null) navigate(subscriptionRoute(space.subscription.id));
      }} />
      <span className="grow" />
      {tools}
    </header>;
  }
  return (
    <div className="page page-fill space-page" data-phone={phone} data-genre={space.genre ?? 'legacy'}>
      {head}
      {renaming ? <div className="space-rename">
        <RenameField value={space.title} label={`「${space.title}」的新名字`}
          onSave={(title) => actions.rename(space.id, title).then(() => {
            setSaved(null);
            reload();
          })} onDone={() => setRenaming(false)} />
      </div> : null}
      {confirm.dialog}
      {space.html === null ? <LegacySpace space={space} phone={phone} /> : (
        <SpaceFrame className="space-frame" mode="page" label={space.title} editing={editing}
          space={{ html: space.html, genre: space.genre ?? 'report', title: space.title,
            dateLabel: letterDate(space.createdAt) }} onEdit={saver.save} onEscape={stopEditing} />
      )}
      {saver.error === null ? null : (
        <div className="space-toast" role="alert">
          <span className="grow">改的字没存上：{saver.error}</span>
          <button type="button" className="text-button" onClick={() => {
            setSaved(null);
            reload();
          }}>重新读取</button>
        </div>
      )}
      {editing || saver.error !== null ? null
        : <ChangeToast key={`${space.id}:${space.version}`} space={space} onChanged={changed} />}
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
