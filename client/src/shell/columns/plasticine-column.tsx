// Plasticine 栏目的第二栏（11-07 设计稿 Plasticine-Main / Plasticine-Memory）：顶上「Plasticine」+ 新旁聊；主线置顶
// （标记 +「主线」，下面一行最新状态）；「旁聊」一节一条一行（标题、时间，最近动过的在前）；记忆贴在最底下（11-07 定）。
// 数据：GET /v2/lines/chats（主线带一行状态 + 旁聊）；线有变化（新旁聊、改标题、主线状态变了）时再读一次。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { ChatsResponse } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { listTime } from '../../views/contacts/contact-time.ts';
import { IconButton } from '../icon-button.tsx';
import { Icon } from '../icons.tsx';
import { PlasticineMark } from '../plasticine-mark.tsx';
import { mainLineRoute, sideRoute, type Route } from '../routes.ts';
import { ColumnCount, ColumnFoot, ColumnHead, ColumnLabel, ColumnLink, ColumnNote } from './column.tsx';

/** 线的列表变了以后隔这么久再读第二栏（流式回复时列表一直在变，不必每一下都读）。 */
const RELOAD_DELAY_MS = 800;

function useChats(): { chats: ChatsResponse | null; error: string | null } {
  const api = useApi();
  const live = useLive();
  const lines = useStore(live.lines.list);
  const [chats, setChats] = useState<ChatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 列表里线的身份、标题、状态变了才重读（同一条线的流式进度不算）。
  const signature = lines.lines.map((line) => `${line.id}:${line.kind}:${line.title}:${line.status}`).join('|');
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.lines.chats(controller.signal).then((next) => {
        setChats(next);
        setError(null);
      }, (cause: unknown) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      });
    }, chats === null ? 0 : RELOAD_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [api, signature]);
  return { chats, error };
}

function useMemoryCount(): number | null {
  const live = useLive();
  const topics = useStore(live.memoryTopics.data);
  useEffect(() => {
    if (topics.status === 'idle') void live.memoryTopics.open();
  }, [live, topics.status]);
  return topics.list?.groups.reduce((sum, group) => sum + group.topics.length, 0) ?? null;
}

export function PlasticineColumn({ route, navigate }: { route: Route; navigate: (route: Route) => void })
  : ReactNode {
  const live = useLive();
  const timeZone = useTimeZone();
  const { chats, error } = useChats();
  const memory = useMemoryCount();
  const [opening, setOpening] = useState<string | null>(null);
  const sideId = route.view === 'plasticine' ? route.lineId ?? null : null;
  const onMain = route.view === 'plasticine' && sideId === null;
  const now = new Date();
  const openSide = (): void => {
    void live.lines.openSide({}).then((opened) => {
      if (typeof opened === 'string') setOpening(opened);
      else {
        setOpening(null);
        navigate(sideRoute(opened.id));
      }
    });
  };
  return (
    <>
      <ColumnHead title="Plasticine">
        <IconButton icon="plus" label="新旁聊" onClick={openSide} />
      </ColumnHead>
      <div className="column-scroll">
        <ColumnLink route={mainLineRoute()} current={onMain} navigate={navigate} className="column-item-main"
          lead={<PlasticineMark size={18} />} sub={chats?.main.status ?? undefined}>主线</ColumnLink>
        {opening === null ? null : <ColumnNote>{opening}</ColumnNote>}
        {error === null ? null : <ColumnNote>{error}</ColumnNote>}
        {chats === null || chats.sides.length === 0 ? null : <>
          <ColumnLabel>旁聊</ColumnLabel>
          {chats.sides.map((line) => (
            <ColumnLink key={line.id} route={sideRoute(line.id)} current={sideId === line.id} navigate={navigate}
              trail={<span className="column-time">{listTime(line.updatedAt, now, timeZone)}</span>}>
              {line.title}
            </ColumnLink>
          ))}
        </>}
      </div>
      <ColumnFoot>
        <ColumnLink route={{ view: 'memory', noteId: null }} current={route.view === 'memory'} navigate={navigate}
          lead={<Icon name="memory" size={16} />} trail={<ColumnCount value={memory} label="份" />}>记忆</ColumnLink>
      </ColumnFoot>
    </>
  );
}
