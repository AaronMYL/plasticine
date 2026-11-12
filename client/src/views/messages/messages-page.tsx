// 消息（11-07 设计稿 Messages：人、群、邮件；Plasticine 有自己的栏目）。
// 电脑：列表在第二栏（messages-column.tsx，筛选 全部 · 人 · 群 · 邮件），主区只放打开的那一条：人 / 群 = 聊天（资料栏 272
// 在最右，聊天头最右的按钮开关、记住开关），邮件 = 阅读区（按原样排版，不进气泡）。没点过时打开列表里的第一条。
// 手机：列表整页（分段控件撑满，底栏照上）→ 点一条是一整页（底栏收起）→ 资料整页，各有返回。
// 地址 #/messages、#/messages/<id>、#/messages/<id>/profile、#/messages/requests（routes.ts）；旧的 #/contacts… 也到这里。

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { ContactDetail, ContactRow } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { messagesRoute, type ContactPane, type Route } from '../../shell/routes.ts';
import type { Resource } from '../m5b/resource-store.ts';
import { ContactProfile } from '../contacts/contact-profile.tsx';
import { focusMemory } from '../contacts/contact-profile-memory.tsx';
import { ContactRequests } from '../contacts/contact-requests.tsx';
import { ContactThread } from '../contacts/contact-thread.tsx';
import { AddFriendPage, InvitePage, NetPane, NewGroupPage } from '../contacts/network-pages.tsx';
import { MailReader } from './mail-reader.tsx';
import { contactInFilter, filterForContact, rowsFor, type MessageFilter } from './message-filter.ts';
import { MessagesList } from './messages-list.tsx';
import '../contacts/contacts.css';
import './messages.css';

export interface MessagesPageProps {
  route: Route;
  phone: boolean;
  navigate: (route: Route) => void;
  /** 「现在」：列表行尾的时间、任务期限按它写；测试给固定的。 */
  now?: () => Date;
}

/**
 * 资料栏占一栏要多宽的主区：聊天至少 420 + 资料 272。窄过它时资料栏改成浮在聊天右边，点按钮才出来、不记开关（记住的
 * 开关只管宽的时候）。
 */
const PROFILE_COLUMN_MIN = 692;

/** 资料栏只随消息区真实宽度变化；悬浮对话不改变下面的阅读布局。 */
function useNarrow(): { ref: RefObject<HTMLDivElement | null>; narrow: boolean } {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const measure = (): void => {
      const measured = element.getBoundingClientRect().width;
      if (measured > 0) {
        setWidth(measured);
      }
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const resize = new ResizeObserver(measure);
      resize.observe(element);
      return () => resize.disconnect();
    }
  }, []);
  return { ref, narrow: width !== null && width < PROFILE_COLUMN_MIN };
}

const NO_DETAIL = new Store<Resource<ContactDetail>>({ status: 'idle', error: null, value: null });

/**
 * 地址里那个人：列表里有就用列表的那一行；列表里没有（刚加上、列表还在拉）就读资料里的那一行；资料也读不到才算找不到。
 */
function useContact(id: string | null): { contact: ContactRow | null; missing: boolean } {
  const { contacts } = useLive();
  const list = useStore(contacts.list.data);
  const detailStore = id === null ? null : contacts.detail(id);
  const detail = useStore(detailStore?.data ?? NO_DETAIL);
  const fromList = id === null ? undefined : list.value?.contacts.find((row) => row.id === id);
  const needDetail = id !== null && fromList === undefined && list.value !== null;
  useEffect(() => {
    if (needDetail) {
      detailStore?.open();
    }
  }, [needDetail, detailStore]);
  const contact = fromList ?? detail.value?.contact ?? null;
  return { contact, missing: needDetail && contact === null && detail.status === 'failed' };
}

/** 筛选跟着打开的那一条走：旧链接直接打开一封邮件时，列表换到它所在的那一段。 */
export function useMessagesFilter(contact: ContactRow | null): [MessageFilter, (filter: MessageFilter) => void] {
  const { messagesUi } = useClientState();
  const filter = useStore(messagesUi.filter);
  const contactId = contact?.id ?? null;
  useEffect(() => {
    if (contact !== null && contact.state !== 'request' && !contactInFilter(contact, filter)) {
      messagesUi.setFilter(filterForContact(contact));
    }
    // 只在换了一条时校一次：之后你自己换筛选，打开的那一条不在里面也不拦。
  }, [contactId]);
  return [filter, (next) => messagesUi.setFilter(next)];
}

/** 电脑上没点过哪一条时打开列表（当前筛选）里的第一条。 */
function useFirstListed(filter: MessageFilter, enabled: boolean): string | null {
  const { contacts } = useLive();
  const list = useStore(contacts.list.data);
  return enabled ? rowsFor(list.value?.contacts ?? [], filter)[0]?.id ?? null : null;
}

/** 右边那一块的读屏名字：和某人的聊天、一封邮件（发件人）。 */
function mainLabel(contact: ContactRow | null): string {
  if (contact === null) {
    return '消息';
  }
  return contact.kind === 'mail' ? contact.name : `和${contact.name}的聊天`;
}

function Missing({ phone, onBack }: { phone: boolean; onBack: () => void }): ReactNode {
  return (
    <div className="contact-missing">
      {phone ? <IconButton icon="back" size={20} label="回到消息" onClick={onBack} /> : null}
      <p className="contact-list-empty">找不到这一条</p>
    </div>
  );
}

/** 列表上那几块（加好友、新建群聊、邀请、新请求）：右边整块，手机上一整页。 */
function ListPane({ pane, phone, navigate }: { pane: ContactPane; phone: boolean; navigate: (route: Route) => void })
  : ReactNode {
  const back = (): void => navigate(messagesRoute(null));
  const open = (id: string): void => navigate(messagesRoute(id));
  switch (pane) {
    case 'add':
      return <AddFriendPage phone={phone} onClose={back} onAdded={open} />;
    case 'new-group':
      return <NewGroupPage phone={phone} onClose={back} onCreated={open} />;
    case 'invite':
      return <InvitePage phone={phone} onClose={back} />;
    case 'requests':
      return (
        <NetPane title="新请求" phone={phone} onClose={back}>
          <ContactRequests onAccepted={open} />
        </NetPane>
      );
    case 'profile':
      return null;
  }
}

export function MessagesPage({ route, phone, navigate, now = () => new Date() }: MessagesPageProps): ReactNode {
  const { shellPrefs } = useClientState();
  const prefs = useStore(shellPrefs.store);
  const { ref, narrow } = useNarrow();
  const [overlay, setOverlay] = useState(false);
  const opened = route.contactId ?? null;
  const listPane = opened === null && route.contactPane !== undefined && route.contactPane !== 'profile'
    ? route.contactPane : null;
  const requests = listPane !== null;
  const firstListed = useFirstListed(useStore(useClientState().messagesUi.filter), !phone && opened === null
    && !requests);
  const contactId = opened ?? firstListed;
  const { contact, missing } = useContact(contactId);
  const [filter, setFilter] = useMessagesFilter(contact);
  const at = now();
  const openContact = (id: string): void => navigate(messagesRoute(id));
  const back = (): void => navigate(messagesRoute(null));
  const list = (
    <MessagesList filter={filter} onFilter={setFilter} selectedId={contactId}
      requestsOpen={listPane === 'requests'} phone={phone} now={at} onOpen={openContact}
      onRequests={() => navigate(messagesRoute(null, 'requests'))}
      onAdd={(choice) => navigate(messagesRoute(null, choice))}
      onProfile={(id, memory) => {
        if (phone) {
          navigate(messagesRoute(id, 'profile'));
        } else {
          navigate(messagesRoute(id));
          if (narrow) setOverlay(true);
          else shellPrefs.setContactProfile(true);
        }
        if (memory) focusMemory(id);
      }}
      onRemoved={(id) => {
        if (id === contactId) back();
      }} />
  );
  const profileOpen = narrow ? overlay : prefs.contactProfile;
  const thread = contact === null ? null : contact.kind === 'mail'
    ? <MailReader contact={contact} phone={phone} now={at} onBack={back} />
    : (
      <ContactThread contact={contact} phone={phone} now={at} navigate={navigate} profileOpen={profileOpen}
        onToggleProfile={() => (narrow ? setOverlay(!overlay) : shellPrefs.setContactProfile(!prefs.contactProfile))}
        onNewTask={() => undefined} />
    );
  if (phone) {
    return (
      <div className="contacts messages" data-phone="true">
        {listPane === null ? <PhonePane route={route} contact={contact} missing={missing}
          list={list} thread={thread} navigate={navigate} />
          : <section className="contacts-phone-page">
            <ListPane pane={listPane} phone navigate={navigate} />
          </section>}
      </div>
    );
  }
  const profile = contact !== null && contact.kind === 'person' && profileOpen;
  return (
    <div ref={ref} className="contacts messages" data-profile={profile && !narrow} data-narrow={narrow}>
      <section className="contacts-main" aria-label={mainLabel(contact)}>
        {listPane === null ? null : <ListPane pane={listPane} phone={false} navigate={navigate} />}
        {!requests && missing ? <Missing phone={false} onBack={back} /> : null}
        {!requests && contactId === null ? <p className="contact-list-empty messages-none">还没有消息</p> : null}
        {requests ? null : thread}
      </section>
      {profile && contact !== null ? (
        <aside className="contacts-profile" aria-label={`${contact.name}的资料`}
          onKeyDown={(event) => {
            if (narrow && event.key === 'Escape') {
              setOverlay(false);
            }
          }}>
          {narrow ? <IconButton icon="close" className="contacts-profile-close" label={`关掉${contact.name}的资料`}
            onClick={() => setOverlay(false)} /> : null}
          <ContactProfile contact={contact} phone={false} onRemoved={back} />
        </aside>
      ) : null}
    </div>
  );
}

function PhonePane({ route, contact, missing, list, thread, navigate }: { route: Route;
  contact: ContactRow | null; missing: boolean; list: ReactNode; thread: ReactNode;
  navigate: (route: Route) => void }): ReactNode {
  const back = (): void => navigate(messagesRoute(null));
  if (route.contactPane === 'requests') {
    return (
      <section className="contacts-phone-page" aria-label="新请求">
        <header className="ct-head" data-phone="true">
          <IconButton icon="back" size={20} label="回到消息" onClick={back} />
          <h1 className="ct-name">新请求</h1>
        </header>
        <ContactRequests onAccepted={(id) => navigate(messagesRoute(id))} />
      </section>
    );
  }
  if (route.contactId == null) {
    return <section className="contacts-phone-page contacts-list" aria-label="消息列表">{list}</section>;
  }
  if (contact === null) {
    return missing ? <Missing phone onBack={back} /> : null;
  }
  if (route.contactPane === 'profile') {
    return (
      <section className="contacts-phone-page" aria-label={`${contact.name}的资料`}>
        <header className="ct-head" data-phone="true">
          <IconButton icon="back" size={20} label={`回到和${contact.name}的聊天`}
            onClick={() => navigate(messagesRoute(contact.id))} />
        </header>
        <ContactProfile contact={contact} phone onRemoved={back} />
      </section>
    );
  }
  return <section className="contacts-phone-page" aria-label={mainLabel(contact)}>{thread}</section>;
}
