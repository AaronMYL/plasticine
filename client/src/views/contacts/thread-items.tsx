// 一段聊天里的各项（第 113 条，布局自己说话）：左 = 对方，右 = 我。人有气泡（我 --tint 底，对方描边），AI 没气泡、前面一个 ✦；
// 我问对方的 Plasticine 的那句，气泡里开头一个 ✦。AI↔AI 那一段折成正中一行「✦ 摘要 · n」，点开摊开。任务卡站在发起方一侧。
// 换一天时正中一行等宽的「11-03 周二」。系统的一句（安全码变了、接上了）正中小字。
// 邮件（2026-11-04 用户定）不进气泡：一封一个整宽阅读区（mail-item.tsx），最新的那封摊开。

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ContactMessageView, ContactRow, ContactThreadItem } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { AiMark } from '../../shell/glyph.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import type { Route } from '../../shell/routes.ts';
import { ContactMessageMedia } from './contact-message-media.tsx';
import { ContactAvatar, FaceAvatar } from './contact-avatar.tsx';
import { ContactMessageActionsProvider, MessageShell, ReplyLine, type ContactMessageActions }
  from './contact-message-row.tsx';
import { setContactReply } from './contact-reply.ts';
import { GroupTaskCard } from './group-task-card.tsx';
import { dayKey, dayLabel } from './contact-time.ts';
import { itemKey, itemTime } from './contacts-store.ts';
import { MailItem } from './mail-item.tsx';
import { TaskCard } from './task-card.tsx';

const GROUP_AI_TIP = '群里只用对全群都能说的资料回答';

function TheirAi({ message, name }: { message: ContactMessageView; name: string }): ReactNode {
  return (
    <div className="cm-line" data-side="them" data-ai="true">
      <span className="cm-ai-slot"><AiMark label={`${name}的 Plasticine`} /></span>
      <p className="cm-ai-text">{message.text}</p>
    </div>
  );
}

function MyAi({ message, group }: { message: ContactMessageView; group: boolean }): ReactNode {
  return (
    <div className="cm-line" data-side="me" data-ai="true">
      <p className="cm-ai-text">{message.text}</p>
      <span className="cm-ai-slot"><AiMark label="你的 Plasticine" /></span>
      {group ? <InfoTip text={GROUP_AI_TIP} label="你的 Plasticine 在群里怎么答" /> : null}
    </div>
  );
}

/** 「小林的」「Alex 的」：名字是拉丁字母结尾时空一格（设计稿的写法）。 */
export function ownerOf(name: string): string {
  return /[A-Za-z0-9]$/.test(name) ? `${name} 的` : `${name}的`;
}

/** 「@✦小林的 Plasticine」：这句 @ 了谁的 Plasticine（聊天里都写名字，菜单里才写「我的」）。 */
export function Mention({ mention }: { mention: NonNullable<ContactMessageView['mention']> }): ReactNode {
  const owner = ownerOf(mention.name);
  return (
    <span className="cm-mention">@<AiMark label={`${owner} Plasticine`} />{owner} Plasticine</span>
  );
}

function Text({ message }: { message: ContactMessageView }): ReactNode {
  return (
    <>
      {message.replyTo === null || message.replyTo === undefined ? null : <ReplyLine reply={message.replyTo} />}
      {message.mention === null || message.mention === undefined ? null : <Mention mention={message.mention} />}
      {message.text}
    </>
  );
}

/** 群里别人说的：上面一行小字是谁，左边是他的头像。 */
function GroupThem({ message }: { message: ContactMessageView }): ReactNode {
  const sender = message.sender;
  if (sender === null || sender === undefined) {
    return <p className="cm-system">{message.text}</p>;
  }
  if (message.author === 'their_ai') {
    return <TheirAi message={message} name={sender.name} />;
  }
  return (
    <div className="cm-group-line">
      <span className="cm-sender">{sender.name}</span>
      <div className="cm-line" data-side="them">
        <FaceAvatar name={sender.name} avatar={sender.avatar} size={24} />
        <div className="cm-bubble"><Text message={message} /></div>
      </div>
    </div>
  );
}

export function ThreadMessage({ message, contact }: { message: ContactMessageView; contact: ContactRow })
  : ReactNode {
  if ((message.attachments?.length ?? 0) > 0 || message.status === 'failed') {
    return <ContactMessageMedia contact={contact} message={message} text={<Text message={message} />} />;
  }
  const group = contact.kind === 'group';
  if (group && (message.author === 'them' || message.author === 'their_ai')) {
    return <GroupThem message={message} />;
  }
  switch (message.author) {
    case 'their_ai':
      return <TheirAi message={message} name={contact.name} />;
    case 'my_ai':
      return <MyAi message={message} group={group} />;
    case 'system':
      return <p className="cm-system">{message.text}</p>;
    case 'them':
      return (
        <div className="cm-line" data-side="them">
          <ContactAvatar row={contact} size={24} />
          <div className="cm-bubble"><Text message={message} /></div>
        </div>
      );
    case 'me':
      return (
        <div className="cm-line" data-side="me" data-status={message.status}>
          <div className="cm-bubble"><Text message={message} /></div>
        </div>
      );
  }
}

function Exchange({ item, contact }: { item: Extract<ContactThreadItem, { type: 'exchange' }>;
  contact: ContactRow }): ReactNode {
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  // 摊开时让摊开的那一段露出来（停在底部时它多半在输入框下面）。
  useEffect(() => {
    if (open) {
      body.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [open]);
  return (
    <div className="cm-exchange" data-open={open}>
      <div className="cm-fold">
        <span className="cm-fold-line" />
        <button type="button" className="cm-fold-button" aria-expanded={open}
          aria-label={`${item.summary}，两边的 Plasticine 说了 ${item.count} 句`}
          onClick={() => setOpen((value) => !value)}>
          <AiMark label="两边的 Plasticine" />
          <span>{item.summary}</span>
          <span className="mono">· {item.count}</span>
        </button>
        <span className="cm-fold-line" />
      </div>
      {open ? (
        <div ref={body} className="cm-exchange-body" role="group" aria-label="两边的 Plasticine 说的">
          {item.messages.map((message) => <ThreadMessage key={message.id} message={message} contact={contact} />)}
        </div>
      ) : null}
    </div>
  );
}

function Item({ item, contact, now, navigate, openMail }: { item: ContactThreadItem; contact: ContactRow; now: Date;
  navigate: (route: Route) => void; openMail: string | null }): ReactNode {
  switch (item.type) {
    case 'message':
      if (item.message.mail !== undefined) {
        return <MailItem contactId={contact.id} message={item.message} defaultOpen={item.message.id === openMail} />;
      }
      return (
        <MessageShell message={item.message}><ThreadMessage message={item.message} contact={contact} /></MessageShell>
      );
    case 'exchange':
      return <Exchange item={item} contact={contact} />;
    case 'task':
      return (
        <div className="cm-line cm-task-line" data-side={item.task.direction === 'out' ? 'me' : 'them'}>
          {item.task.direction === 'in' ? <span className="cm-avatar-gap" /> : null}
          <TaskCard task={item.task} name={contact.name} now={now} navigate={navigate} />
        </div>
      );
    case 'group_task': {
      const mine = item.task.owner.self;
      return (
        <div className="cm-group-line">
          {mine ? null : <span className="cm-sender">{item.task.owner.name}</span>}
          <div className="cm-line cm-task-line" data-side={mine ? 'me' : 'them'}>
            {mine ? null : <FaceAvatar name={item.task.owner.name} avatar={item.task.owner.avatar} size={24} />}
            <GroupTaskCard task={item.task} now={now} navigate={navigate} />
          </div>
        </div>
      );
    }
  }
}

export interface ThreadItemsProps {
  items: readonly ContactThreadItem[];
  contact: ContactRow;
  now: Date;
  navigate: (route: Route) => void;
}

/** 最新的那封来信（默认摊开）。 */
function latestMail(items: readonly ContactThreadItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === 'message' && item.message.mail !== undefined) {
      return item.message.id;
    }
  }
  return null;
}

/** 人和人聊天里一句话能做的事：引用（回这一句）、加表情。邮件和只读来源没有。 */
function useMessageActions(contact: ContactRow): ContactMessageActions | null {
  const { contactEdits } = useLive();
  const chat = contact.kind === 'group' || (contact.kind === 'person' && contact.canSend);
  return useMemo(() => {
    if (!chat) return null;
    const authorOf = (message: ContactMessageView): string =>
      message.sender?.name ?? (message.author === 'me' ? '自己' : contact.name);
    return {
      authorOf,
      quote: (message) => setContactReply(contact.id, { id: message.id, author: authorOf(message),
        text: message.text }),
      react: (message, emoji, on) => {
        void contactEdits.react(contact.id, message.id, emoji, on).then((problem) => {
          if (problem !== null) console.warn(`没能加上表情：${problem}`);
        });
      },
    };
  }, [chat, contact.id, contact.name, contactEdits]);
}

export function ThreadItems({ items, contact, now, navigate }: ThreadItemsProps): ReactNode {
  const actions = useMessageActions(contact);
  return (
    <ContactMessageActionsProvider value={actions}>
      <ThreadList items={items} contact={contact} now={now} navigate={navigate} />
    </ContactMessageActionsProvider>
  );
}

function ThreadList({ items, contact, now, navigate }: ThreadItemsProps): ReactNode {
  const timeZone = useTimeZone();
  const openMail = latestMail(items);
  let previousDay = '';
  return items.map((item) => {
    const at = itemTime(item);
    const day = dayKey(at, timeZone);
    const separator = day === previousDay ? null : <p className="cm-day mono">{dayLabel(at, timeZone)}</p>;
    previousDay = day;
    return (
      <div key={itemKey(item)} className="ct-item">
        {separator}
        <Item item={item} contact={contact} now={now} navigate={navigate} openMail={openMail} />
      </div>
    );
  });
}
