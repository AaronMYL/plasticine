// 消息里点开一封邮件（2026-11-04 第 2 批，设计稿 Mail）：右边是阅读区，不是聊天。顶上主题当标题，下面一行发件人
// （信封方块 + 名字 + 时间，地址和完整时间在悬停浮框里），右上「在 Gmail 打开」和 ⋯（回复、复制发件地址）；正文按原样
// 排版（MailBody：HTML 进沙箱 iframe，纯文字照原段落），不进聊天气泡。同一个地址的信按地址归并在一起：默认看最新一封，
// 更早的列在正文下面，点一封换过去。打开有未读的就标成读到最后一封。手机上是一整页，左上角回到列表。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ContactMessageView, ContactRow } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { openExternal } from '../../shell/open-external.ts';
import { MenuItem, Popover, anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import { useStore } from '../../state/use-store.ts';
import { LoadNote } from '../m5b/load-note.tsx';
import { ContactAvatar } from '../contacts/contact-avatar.tsx';
import { ContactComposer } from '../contacts/contact-composer.tsx';
import { clockTime, listTime, shortDate } from '../contacts/contact-time.ts';
import { itemTime, joinItems } from '../contacts/contacts-store.ts';
import { MailReading } from '../contacts/mail-item.tsx';
import '../contacts/mail.css';

/**
 * 在 Gmail 里找到这封信：按发件地址和主题搜（服务端没给 Gmail 里那一封的直接地址；in:anywhere 连归档的也找）。
 * 主题里的引号换成空格，免得截断搜索词。
 */
export function gmailSearchUrl(address: string, subject: string): string {
  const cleaned = subject.replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim();
  const query = cleaned === '' ? `in:anywhere from:${address}` : `in:anywhere from:${address} subject:"${cleaned}"`;
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
}

/** 这个地址来的信，新的在前（我回的那几句不算）。 */
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
  // 同一处只标一次：列表行在回答回来之前还会再变几次，不重复发。
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
            <span className="mono mail-reader-other-time">{listTime(mail.at, now, timeZone)}</span>
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
            // 11-04 重做悬停：发件地址是「对方是谁」，常显在名字后面；完整日期和列表时间重复，不再写。
            <p className="mail-reader-from">
              <ContactAvatar row={contact} size={20} />
              <span className="mail-reader-sender">{sender}</span>
              {address === '' || address === sender ? null : <span className="mail-reader-address">{address}</span>}
              <time className="mono mail-reader-time" dateTime={shown.at}>{listTime(shown.at, now, timeZone)}</time>
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
