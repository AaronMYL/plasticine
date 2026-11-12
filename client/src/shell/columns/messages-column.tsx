// 消息栏目的第二栏（11-07 设计稿 Messages）：人、群、邮件（全部 / 人 / 群 / 邮件）。列表和手机消息页是同一个组件
// （views/messages/messages-list.tsx），筛选记在 MessagesUi 里两处共用。

import type { ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { rowsFor } from '../../views/messages/message-filter.ts';
import { focusMemory } from '../../views/contacts/contact-profile-memory.tsx';
import { MessagesList } from '../../views/messages/messages-list.tsx';
import { messagesRoute, type Route } from '../routes.ts';

export function MessagesColumn({ route, navigate }: { route: Route; navigate: (route: Route) => void }): ReactNode {
  const { messagesUi, shellPrefs } = useClientState();
  const filter = useStore(messagesUi.filter);
  const { contacts } = useLive();
  const list = useStore(contacts.list.data);
  const opened = route.view === 'messages' ? route.contactId ?? null : null;
  // 主区没点过哪一条时打开的是列表里的第一条（messages-page.tsx）：这里也把它标成当前那一行。
  const onList = route.view === 'messages' && opened === null && route.contactPane === undefined;
  const selected = onList ? rowsFor(list.value?.contacts ?? [], filter)[0]?.id ?? null : opened;
  return (
    <MessagesList filter={filter} onFilter={(next) => messagesUi.setFilter(next)} selectedId={selected}
      requestsOpen={route.view === 'messages' && route.contactPane === 'requests'} phone={false} now={new Date()}
      onOpen={(id) => navigate(messagesRoute(id))} onRequests={() => navigate(messagesRoute(null, 'requests'))}
      onAdd={(choice) => navigate(messagesRoute(null, choice))}
      onProfile={(id, memory) => {
        navigate(messagesRoute(id));
        shellPrefs.setContactProfile(true);
        if (memory) focusMemory(id);
      }}
      onRemoved={(id) => {
        if (id === opened) navigate(messagesRoute(null));
      }} />
  );
}
