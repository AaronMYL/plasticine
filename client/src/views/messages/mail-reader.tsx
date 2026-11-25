import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ContactMessageView, ContactRow } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { openExternal } from '../../shell/open-external.ts';
import { MenuItem, Popover, anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import { useStore } from '../../state/use-store.ts';
import { LoadNote } from '../../shell/load-note.tsx';
import { ContactAvatar } from '../contacts/contact-avatar.tsx';
import { ContactComposer } from '../contacts/contact-composer.tsx';
import { itemTime, joinItems } from '../contacts/contacts-store.ts';
import { MailReading } from '../contacts/mail-item.tsx';
import '../contacts/mail.css';
import { timeText } from '../../shell/time-text.ts';

export function gmailSearchUrl(address: string, subject: string): string {
  const cleaned = subject.replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim();
  const query = cleaned === '' ? `in:anywhere from:${address}` : `in:anywhere from:${address} subject:"${cleaned}"`;
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
}

export function mailsOf(messages: readonly ContactMessageView[]): ContactMessageView[] {
  return messages.filter((message) => message.mail !== undefined && message.author === 'them')
    .sort((a, b) => b.at.localeCompare(a.at));
}

export interface MailReaderProps {
  contact: ContactRow;
  phone: boolean;
  now: Date;
  onBack: () => void;
}

function useMarkRead(contact: ContactRow, lastAt: string | null): void {
  const { contactActions } = useLive();
  const marked = useRef<string | null>(null);
  useEffect(() => {
    const mark = `${contact.id}|${lastAt ?? ''}`;
    if (contact.unread > 0 && lastAt !== null && marked.current !== mark) {
      marked.current = mark;
      void contactActions.markRead(contact, lastAt);
    }
  }, [contactActions, contact, lastAt]);
}

function MoreMenu({ anchor, contact, onReply, onClose }: { anchor: PopoverAnchor; contact: ContactRow;
  onReply: (() => void) | null; onClose: () => void }): ReactNode {
  const run = (action: () => void) => (): void => {
    onClose();
    action();
  };
  return (
    <Popover anchor={anchor} role="menu" align="end" label="这封邮件的更多操作" onClose={onClose}>
      {onReply === null ? null : <MenuItem icon="edit" label="回复" onSelect={run(onReply)} />}
      {contact.address === null ? null : <MenuItem icon="copy" label="复制发件地址" onSelect={run(() => {
        navigator.clipboard?.writeText(contact.address ?? '')
          .catch((cause: unknown) => console.warn('发件地址没能复制', cause));
      })} />}
    </Popover>
  );
}

function Others({ mails, current, now, onPick }: { mails: readonly ContactMessageView[]; current: string;
  now: Date; onPick: (id: string) => void }): ReactNode {
  const timeZone = useTimeZone();
  const others = mails.filter((mail) => mail.id !== current);
  if (others.length === 0) {
    return null;
  }
  return (
    <ul className="mail-reader-others" aria-label="这个地址来的其他邮件">
      {others.map((mail) => (
        <li key={mail.id}>
          <button type="button" className="mail-reader-other" onClick={() => onPick(mail.id)}>
            <span className="mail-reader-other-subject">{mail.mail?.subject ?? mail.text}</span>
            <span className="mono mail-reader-other-time">{timeText(mail.at, now, timeZone)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MailReader({ contact, phone, now, onBack }: MailReaderProps): ReactNode {
  const { contacts } = useLive();
  const timeZone = useTimeZone();
  const thread = contacts.thread(contact.id);
  const latest = useStore(thread.latest.data);
  const earlier = useStore(thread.earlier);
  const [picked, setPicked] = useState<string | null>(null);
  const [menu, setMenu] = useState<PopoverAnchor | null>(null);
  const [replying, setReplying] = useState(false);
  useEffect(() => {
    thread.latest.open();
  }, [thread]);
  useEffect(() => {
    setPicked(null);
    setReplying(false);
  }, [contact.id]);
  const items = joinItems(earlier.items, latest.value?.items ?? []);
  const last = items.at(-1);
  useMarkRead(contact, last === undefined ? null : itemTime(last));
  const mails = mailsOf(items.flatMap((item) => (item.type === 'message' ? [item.message] : [])));
  const shown = mails.find((mail) => mail.id === picked) ?? mails[0];
  const subject = shown?.mail?.subject ?? contact.name;
  const sender = shown?.mail?.fromName ?? contact.name;
  const address = shown?.mail?.fromAddress ?? contact.address ?? '';
  const iconSize = phone ? 20 : 16;
  return (
    <article className="mail-reader" data-phone={phone} aria-label={subject}>
      <header className="mail-reader-head">
        {phone ? <IconButton icon="back" size={20} label="回到消息" onClick={onBack} /> : null}
        <div className="mail-reader-title">
          <h2 className="mail-reader-subject">{subject}</h2>
          {shown === undefined ? null : (
            <p className="mail-reader-from">
              <ContactAvatar row={contact} size={20} />
              <span className="mail-reader-sender">{sender}</span>
              {address === '' || address === sender ? null : <span className="mail-reader-address">{address}</span>}
              <time className="mono mail-reader-time" dateTime={shown.at}>{timeText(shown.at, now, timeZone)}</time>
            </p>
          )}
        </div>
        <IconButton icon="external" size={iconSize} label="在 Gmail 打开"
          onClick={() => openExternal(gmailSearchUrl(address, shown?.mail?.subject ?? ''), 'Gmail')} />
        <IconButton icon="more" size={iconSize} label="更多" aria-expanded={menu !== null}
          onClick={(event) => setMenu(anchorOf(event.currentTarget))} />
      </header>
      <div className="mail-reader-body">
        <div className="mail-reader-page">
          <LoadNote resource={latest} what="邮件" onRetry={() => void thread.latest.reload()} />
          {shown === undefined ? null : <MailReading key={shown.id} contactId={contact.id} message={shown} />}
          <Others mails={mails} current={shown?.id ?? ''} now={now} onPick={setPicked} />
        </div>
      </div>
      {replying ? (
        <ContactComposer contact={contact} predict={false} phone={phone}
          onNewTask={null} />
      ) : null}
      {menu === null ? null : (
        <MoreMenu anchor={menu} contact={contact} onClose={() => setMenu(null)}
          onReply={contact.canSend ? () => setReplying(true) : null} />
      )}
    </article>
  );
}
