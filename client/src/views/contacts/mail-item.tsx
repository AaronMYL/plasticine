import { useEffect, useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import type { ContactMessageView, MailBodyResponse } from '../../api/shared.ts';
import { useApi } from '../../api/context.tsx';
import { useTimeZone } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { clockTime } from './contact-time.ts';
import { MailBody } from './mail-body.tsx';
import './mail.css';
import { PageLoading } from '../../primitives/page-loading/index.tsx';

type Loaded = { status: 'loading' } | { status: 'ready'; body: MailBodyResponse } | { status: 'failed'; error: string };

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

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
    return <PageLoading rows={4} />;
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
