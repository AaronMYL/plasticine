// 和一个联系人的聊天（第 113 条，设计稿 Main 中栏 / Phone-Thread；2026-11-04 起在「消息」里）。电脑：头上只有名字 + 发任务 / 找 / 资料栏三个图标；
// 手机：返回、头像和名字（点开资料整页）、✦（问我的 Plasticine，打开对话）。下面是一段聊天（往上滚到顶读更早的一页；
// 停在底部时新来的接着跟到底，翻看旧的时不抢位置），再下面是输入框：人和邮件有，系统来源没有，对方的请求还没接受时是
// 接受 / 拉黑 / 忽略。打开有未读的聊天就标成读到最后一项。

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ContactRow, ContactThreadItem } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { messagesRoute, type Route } from '../../shell/routes.ts';
import { LoadNote } from '../m5b/load-note.tsx';
import { ContactAvatar } from './contact-avatar.tsx';
import { ContactComposer } from './contact-composer.tsx';
import { ContactRequests } from './contact-requests.tsx';
import { itemTime, joinItems } from './contacts-store.ts';
import { GroupMenu } from './group-menu.tsx';
import { TaskCompose } from './task-compose.tsx';
import { ThreadItems } from './thread-items.tsx';
import './contact-thread.css';
import './network.css';

/** 离底部这么近（px）就算停在底部，新来的跟到底。 */
const FOLLOW_SLACK = 48;

function textsOf(item: ContactThreadItem): string[] {
  switch (item.type) {
    case 'message':
      return item.message.mail === undefined ? [item.message.text] : [item.message.mail.subject, item.message.text];
    case 'task':
      return [item.task.title, item.task.goal, item.task.acceptance];
    case 'group_task':
      return [item.task.title, item.task.goal];
    case 'exchange':
      return [item.summary, ...item.messages.map((message) => message.text)];
  }
}

export function findItems(items: readonly ContactThreadItem[], query: string): ContactThreadItem[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [...items];
  }
  return items.filter((item) => textsOf(item).some((text) => text.toLowerCase().includes(needle)));
}

export interface ContactThreadProps {
  contact: ContactRow;
  phone: boolean;
  now: Date;
  profileOpen: boolean;
  navigate: (route: Route) => void;
  onToggleProfile: () => void;
  onNewTask: () => void;
}

/** 能发任务卡：互加了的人、还在的群。 */
function canSendTask(contact: ContactRow): boolean {
  return (contact.kind === 'person' && contact.state === 'active') || (contact.kind === 'group' && contact.canSend);
}

function DesktopHead(props: ContactThreadProps & { finding: boolean; onFind: () => void; composing: boolean })
  : ReactNode {
  const { contact } = props;
  const avatar = contact.kind === 'person' || contact.kind === 'group';
  return (
    <header className="ct-head">
      <div className="ct-head-who">
        {avatar ? <ContactAvatar row={contact} size={24} /> : null}
        <h2 className="ct-name">{contact.name}</h2>
        {contact.kind === 'group' ? <span className="ct-count">{contact.memberCount}</span> : null}
      </div>
      {canSendTask(contact)
        ? <IconButton icon="tasks" label="发任务" aria-pressed={props.composing} onClick={props.onNewTask} /> : null}
      <IconButton icon="search" label="在这段聊天里找" aria-pressed={props.finding} onClick={props.onFind} />
      {contact.kind === 'group' ? <GroupMenu group={contact} onLeft={() => props.navigate(messagesRoute(null))} />
        : null}
      {contact.kind === 'person' ? (
        // 资料栏只给人：邮件和系统来源（AI 建议）的资料只有名字，不占一栏（2026-11-04 消息）。
        <IconButton icon="panel-right" className="ct-profile-toggle" aria-pressed={props.profileOpen}
          label={props.profileOpen ? `关掉${contact.name}的资料` : `打开${contact.name}的资料`}
          onClick={props.onToggleProfile} />
      ) : null}
    </header>
  );
}

function PhoneHead({ contact, navigate, onNewTask }: Pick<ContactThreadProps, 'contact' | 'navigate'
  | 'onNewTask'>): ReactNode {
  const { shellPrefs } = useClientState();
  return (
    <header className="ct-head" data-phone="true">
      <IconButton icon="back" size={20} label="回到消息" onClick={() => navigate(messagesRoute(null))} />
      <button type="button" className="ct-who" aria-label={`${contact.name}的资料`}
        onClick={() => navigate(messagesRoute(contact.id, 'profile'))}>
        <ContactAvatar row={contact} size={28} />
        <span className="ct-name">{contact.name}</span>
      </button>
      {contact.kind === 'group' ? <IconButton icon="tasks" size={20} label="发任务" onClick={onNewTask} />
        : <IconButton icon="sparkle" size={20} label="问我的 Plasticine"
          onClick={() => shellPrefs.setPhoneChatOpen(true)} />}
    </header>
  );
}

/** 停在底部就跟着新来的到底；翻看旧的时不动。第一次读到时到底。 */
function useFollowBottom(count: number, contactId: string) {
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    atBottom.current = true;
  }, [contactId]);
  useLayoutEffect(() => {
    const element = list.current;
    if (element !== null && atBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [count, contactId]);
  const onScroll = (): void => {
    const element = list.current;
    if (element !== null) {
      atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_SLACK;
    }
  };
  return { list, onScroll };
}

export function ContactThread(props: ContactThreadProps): ReactNode {
  const { contact, phone, now, navigate } = props;
  const { contacts, contactActions } = useLive();
  const thread = contacts.thread(contact.id);
  const latest = useStore(thread.latest.data);
  const earlier = useStore(thread.earlier);
  const [query, setQuery] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    thread.latest.open();
  }, [thread]);
  useEffect(() => {
    setQuery(null);
    setComposing(false);
  }, [contact.id]);
  const withCompose = { ...props, onNewTask: () => setComposing((value) => !value) };
  const items = joinItems(earlier.items, latest.value?.items ?? []);
  const last = items.at(-1);
  const lastAt = last === undefined ? null : itemTime(last);
  // 同一处只标一次：列表行在回答回来之前还会再变几次，不重复发。
  const marked = useRef<string | null>(null);
  useEffect(() => {
    const mark = `${contact.id}|${lastAt ?? ''}`;
    if (contact.unread > 0 && lastAt !== null && marked.current !== mark) {
      marked.current = mark;
      void contactActions.markRead(contact, lastAt);
    }
  }, [contactActions, contact, lastAt]);
  const { list, onScroll } = useFollowBottom(items.length, contact.id);
  const hasMore = earlier.hasMore ?? latest.value?.hasMore ?? false;
  const shown = query === null ? items : findItems(items, query);
  const loadEarlier = (): void => {
    if (hasMore && list.current !== null && list.current.scrollTop <= 0) {
      void thread.loadEarlier();
    }
  };
  return (
    <div className="contact-thread" data-phone={phone}>
      {phone ? <PhoneHead contact={contact} navigate={navigate} onNewTask={withCompose.onNewTask} />
        : <DesktopHead {...withCompose} composing={composing} finding={query !== null}
          onFind={() => setQuery((value) => (value === null ? '' : null))} />}
      {query === null ? null : (
        <input className="field-input ct-find" type="search" aria-label="在这段聊天里找" value={query} autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery(null);
            }
          }} />
      )}
      <div ref={list} className="ct-items" aria-label={`和${contact.name}的聊天记录`} role="log"
        onScroll={() => {
          onScroll();
          loadEarlier();
        }}>
        {hasMore ? <button type="button" className="text-button text-button-quiet ct-earlier"
          disabled={earlier.status === 'loading'} onClick={() => void thread.loadEarlier()}>更早的</button> : null}
        {earlier.error === null ? null : <p className="block-empty is-error" role="alert">{earlier.error}</p>}
        <LoadNote resource={latest} what="聊天" onRetry={() => void thread.latest.reload()} />
        <ThreadItems items={shown} contact={contact} now={now} navigate={navigate} />
      </div>
      <ThreadFoot {...withCompose} suggestion={latest.value?.suggestion ?? null} />
      {composing && canSendTask(contact)
        ? <TaskCompose contact={contact} phone={phone} onClose={() => setComposing(false)} /> : null}
    </div>
  );
}

function ThreadFoot(props: ContactThreadProps & { suggestion: string | null }): ReactNode {
  const { contact, phone } = props;
  if (contact.state === 'request') {
    return (
      <div className="ct-request">
        <ContactRequests onAccepted={(id) => props.navigate(messagesRoute(id))}
          only={contact.id} />
      </div>
    );
  }
  if (!contact.canSend) {
    return null;
  }
  const newTask = canSendTask(contact) ? props.onNewTask : null;
  return <ContactComposer contact={contact} suggestion={props.suggestion} phone={phone} onNewTask={newTask} />;
}
