import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { MAIN_LINE_ALIAS, type MateListResponse, type LineView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { useCurrentTab } from '../../shell/current-tab-context.ts';
import { Icon } from '../../shell/icons.tsx';
import { Popover, anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import { routeHash } from '../../shell/routes.ts';
import { useMainIdentity } from './main-identity.tsx';
import { MainAvatar, MateAvatar, GroupAvatar } from './mate-avatar.tsx';
import './mates.css';

function writerTarget(writer: string, roster: MateListResponse, line?: LineView): string | null {
  const direct = roster.mates.find((mate) => mate.lineId === writer && mate.disabledAt === null);
  if (direct !== undefined) return direct.lineId;
  const group = roster.groups.find((item) => item.lineId === writer || item.id === line?.mateGroupId);
  const mate = roster.mates.find((item) => item.id === line?.mateId && item.disabledAt === null);
  return mate?.lineId ?? group?.lineId ?? null;
}

/** 作者信息可以晚到；本页已手选或开始写字后，保持当时的对象。 */
export function DockTargetSync(): ReactNode {
  const api = useApi();
  const live = useLive();
  const state = useClientState();
  const roster = useStore(live.mates.data);
  const tab = useCurrentTab();
  const route = tab?.route;
  const pageKey = route == null ? tab?.url ?? tab?.id ?? '' : routeHash(route);
  const pageKind = route?.spaceId != null ? 'spaces' : route?.view ?? 'web';
  const spaceId = route?.spaceId;
  const [author, setAuthor] = useState<{ key: string; lineId: string | null }>({ key: '', lineId: null });
  const allowed = new Set([MAIN_LINE_ALIAS, ...roster.mates.filter((mate) => mate.disabledAt === null)
    .map((mate) => mate.lineId), ...roster.groups.map((group) => group.lineId)]);
  const availableKey = [...allowed].join('|');
  useEffect(() => state.conversations.revision.subscribe(() => {
    const current = state.conversations.forLine(state.dockTargets.store.get().lineId);
    const draft = current.ui.store.get();
    if (draft.draft !== '' || draft.quotes.length > 0 || current.attachments.hasAny()) {
      state.dockTargets.protectCurrent();
    }
  }), [state]);
  useLayoutEffect(() => {
    if (roster.status !== 'ready' && roster.status !== 'failed') return;
    state.dockTargets.enterPage(pageKey, pageKind, author.key === pageKey ? author.lineId : null, allowed);
  }, [state, roster.status, pageKey, pageKind, availableKey, author]);
  useEffect(() => {
    if (spaceId == null || roster.status !== 'ready') return;
    const controller = new AbortController();
    void (async () => {
      const space = await api.spaces.get(spaceId, controller.signal);
      const writer = space.writerLineId;
      if (writer == null) return null;
      const direct = writerTarget(writer, roster);
      if (direct !== null) return direct;
      const line = live.lines.list.get().lines.find((item) => item.id === writer)
        ?? (await api.lines.read(writer, { limit: 1 }, controller.signal)).line;
      return writerTarget(writer, roster, line);
    })().then((lineId) => {
      if (!controller.signal.aborted) setAuthor({ key: pageKey, lineId });
    }, (cause: unknown) => {
      if (!controller.signal.aborted) {
        state.dockTargets.setError(`页面作者暂时没读到：${errorText(cause)}`);
      }
    });
    return () => controller.abort();
  }, [api, live, state, pageKey, spaceId, roster]);
  return null;
}

export function DockTargetSelector(): ReactNode {
  const live = useLive();
  const state = useClientState();
  const target = useStore(state.dockTargets.store);
  const targetError = useStore(state.dockTargets.error);
  const roster = useStore(live.mates.data);
  const error = targetError ?? roster.error;
  const [menu, setMenu] = useState<PopoverAnchor | null>(null);
  const mate = roster.mates.find((item) => item.lineId === target.lineId);
  const group = roster.groups.find((item) => item.lineId === target.lineId);
  const select = (lineId: string): void => { state.dockTargets.choose(lineId); setMenu(null); };
  const main = useMainIdentity();
  return <div className="dock-target-head">
    <button type="button" className="dock-target-button" aria-label="切换对话对象" aria-expanded={menu !== null}
      onClick={(event) => setMenu(anchorOf(event.currentTarget))}>
      {mate !== undefined ? <MateAvatar mate={mate} size={24} /> : group !== undefined
        ? <GroupAvatar mates={roster.mates.filter((item) => group.mateIds.includes(item.id))} />
        : <MainAvatar size={24} />}
      <span>{mate?.name ?? group?.name ?? main.name}</span><Icon name="chevron-down" size={12} />
    </button>
    {target.fromWriter ? <span className="dock-writer">写过这一页</span> : null}
    {menu === null ? null : <Popover anchor={menu} role="menu" label="对话对象" align="start"
      onClose={() => setMenu(null)}>
      <TargetItem label={`${main.name} 主线`} selected={target.lineId === MAIN_LINE_ALIAS}
        lead={<MainAvatar size={24} />} onSelect={() => select(MAIN_LINE_ALIAS)} />
      <p className="dock-target-section">队友</p>
      {roster.mates.filter((item) => item.disabledAt === null).map((item) => <TargetItem key={item.id}
        label={item.name} selected={target.lineId === item.lineId} lead={<MateAvatar mate={item} size={24} />}
        onSelect={() => select(item.lineId)} />)}
      {roster.groups.length === 0 ? null : <p className="dock-target-section">群组</p>}
      {roster.groups.map((item) => <TargetItem key={item.id} label={item.name} selected={target.lineId === item.lineId}
        lead={<GroupAvatar mates={roster.mates.filter((mate) => item.mateIds.includes(mate.id))} />}
        onSelect={() => select(item.lineId)} />)}
      {error === null ? null : <p className="dock-target-error" role="alert">{error}</p>}
    </Popover>}
  </div>;
}

function TargetItem({ label, selected, lead, onSelect }: { label: string; selected: boolean;
  lead: ReactNode; onSelect: () => void }): ReactNode {
  return <button type="button" role="menuitemcheckbox" aria-checked={selected} aria-label={label}
    className="popover-item dock-target-item" onClick={onSelect}>{lead}<span className="popover-item-label">
      {label}</span>{selected ? <Icon name="check" size={14} /> : null}</button>;
}

/** 对话框现在对着谁（主线、某位队友、某个群组）：名字和头像（收起时右下角的入口用，第13批）。 */
export function useDockTarget(): { name: string; avatar: (size: number) => ReactNode } {
  const live = useLive();
  const state = useClientState();
  const target = useStore(state.dockTargets.store);
  const roster = useStore(live.mates.data);
  const main = useMainIdentity();
  const mate = roster.mates.find((item) => item.lineId === target.lineId);
  const group = roster.groups.find((item) => item.lineId === target.lineId);
  if (mate !== undefined) return { name: mate.name, avatar: (size) => <MateAvatar mate={mate} size={size} /> };
  if (group !== undefined) {
    return { name: group.name, avatar: (size) => <GroupAvatar size={Math.round(size * 0.6)}
      mates={roster.mates.filter((item) => group.mateIds.includes(item.id))} /> };
  }
  return { name: main.name, avatar: (size) => <MainAvatar size={size} /> };
}
