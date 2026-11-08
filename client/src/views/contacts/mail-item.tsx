// 聊天里的一封来信（用户 2026-11-04 定：点开一封邮件是整宽的阅读区，不进聊天气泡）。收着是一行：标题、时间，下面一行
// 正文开头；点开是阅读区：发件人一行、正文（HTML 进沙箱 iframe，纯文字照原段落）、附件名。正文点开时才取。
// 一段来往里最新的那封默认摊开（和看信的习惯一样，旧的收着）。

import { useEffect, useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import type { ContactMessageView, MailBodyResponse } from '../../api/shared.ts';
import { useApi } from '../../api/context.tsx';
import { useTimeZone } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { clockTime } from './contact-time.ts';
import { MailBody } from './mail-body.tsx';
import './mail.css';

type Loaded = { status: 'loading' } | { status: 'ready'; body: MailBodyResponse } | { status: 'failed'; error: string };

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 一封信的正文和附件名：挂上时取（换一封重取），取的期间写「正在读这封邮件…」，失败写原因。 */
export function MailReading({ contactId, message }: { contactId: string; message: ContactMessageView }): ReactNode {
  const api = useApi();
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setLoaded({ status: 'loading' });
    api.contacts.mailBody(contactId, message.id, controller.signal).then(
      (body) => {
        if (!controller.signal.aborted) {
          setLoaded({ status: 'ready', body });
        }
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setLoaded({ status: 'failed', error: errorText(cause) });
        }
      },
    );
    return () => controller.abort();
  }, [api, contactId, message.id]);
  if (loaded.status === 'loading') {
    return <p className="block-empty mail-wait">正在读这封邮件…</p>;
  }
  if (loaded.status === 'failed') {
    return <p className="block-empty is-error" role="alert">{loaded.error}</p>;
  }
  const { body } = loaded;
  return (
    <>
      <MailBody subject={body.subject} html={body.html} text={body.text} />
      {body.attachments.length === 0 ? null : (
        <ul className="mail-attachments" aria-label="附件">
          {body.attachments.map((name) => (
            <li key={name}><Icon name="paperclip" size={12} />{name}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export interface MailItemProps {
  contactId: string;
  message: ContactMessageView;
  defaultOpen: boolean;
}

export function MailItem({ contactId, message, defaultOpen }: MailItemProps): ReactNode {
  const timeZone = useTimeZone();
  const [open, setOpen] = useState(defaultOpen);
  const mail = message.mail;
  if (mail === undefined) {
    return null;
  }
  const sender = mail.fromName === null ? mail.fromAddress : `${mail.fromName} <${mail.fromAddress}>`;
  return (
    <article className="mail-item" data-open={open} aria-label={mail.subject}>
      <button type="button" className="mail-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="mail-subject">{mail.subject}</span>
        <time className="mail-time text-meta" dateTime={message.at}>{clockTime(message.at, timeZone)}</time>
      </button>
      {open ? (
        <div className="mail-read">
          <p className="mail-from text-meta">{sender}</p>
          <MailReading contactId={contactId} message={message} />
        </div>
      ) : <p className="mail-preview">{preview(message.text)}</p>}
    </article>
  );
}
