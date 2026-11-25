import type { ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { rowsFor } from '../../state/message-filter.ts';
import { focusMemory } from '../../views/contacts/contact-profile-memory.tsx';
import { MessagesList } from '../../views/messages/messages-list.tsx';
import { messagesRoute, type Route } from '../routes.ts';

export function MessagesColumn({ route, navigate }: { route: Route; navigate: (route: Route) => void }): ReactNode {
  const { messagesUi, shellPrefs } = useClientState();
  const filter = useStore(messagesUi.filter);
  const { contacts } = useLive();
  const list = useStore(contacts.list.data);
  const opened = route.view === 'messages' ? route.contactId ?? null : null;
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
