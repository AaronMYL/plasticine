import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { ContactMessageView, ContactRow } from '../../api/shared.ts';
import { createRequestId } from '../../api/request-id.ts';
import { errorText } from '../../api/errors.ts';
import { useLive } from '../../live.tsx';
import { AiMark } from '../../shell/glyph.tsx';
import { AttachmentGallery, type AttachmentMedia } from '../conversation/attachment-gallery.tsx';
import { ContactAvatar, FaceAvatar } from './contact-avatar.tsx';
import './network-attachments.css';

export function ContactMessageMedia({ contact, message, text }: {
  contact: ContactRow; message: ContactMessageView; text: ReactNode;
}): ReactNode {
  const api = useApi();
  const live = useLive();
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(createRequestId());
  const mine = message.author === 'me' || message.author === 'my_ai';
  const ai = message.author === 'my_ai' || message.author === 'their_ai';
  const items = useMemo(() => (message.attachments ?? []).map((row): AttachmentMedia => ({
    id: row.id, name: row.name, mimeType: row.mimeType, bytes: row.bytes,
    url: api.networkAttachments.contentUrl(contact.id, message.id, row.id),
    ...(row.thumbnail === undefined ? {} : { thumbnailUrl:
      `data:${row.thumbnail.mimeType};base64,${row.thumbnail.content.replaceAll('-', '+').replaceAll('_', '/')}` }),
    loadContent: async (signal) => {
      try { return await api.networkAttachments.content(contact.id, message.id, row.id, signal); }
      catch (cause) { if (!signal.aborted) setError(errorText(cause)); throw cause; }
    },
  })), [api, contact.id, message.id, message.attachments, revision]);
  const retry = async (): Promise<void> => {
    setBusy(true); setError(null);
    try {
      const next = await api.networkAttachments.retry(contact.id, message.id, requestId.current);
      live.contacts.thread(contact.id).put({ type: 'message', message: next });
      requestId.current = createRequestId();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const avatar = contact.kind === 'group' && message.sender != null
    ? <FaceAvatar name={message.sender.name} avatar={message.sender.avatar} size={24} />
    : <ContactAvatar row={contact} size={24} />;
  const gallery = <AttachmentGallery key={revision} items={items} />;
  return <div className="cm-media-message" data-side={mine ? 'me' : 'them'}>
    {mine || contact.kind !== 'group' || message.sender == null ? null :
      <span className="cm-sender">{message.sender.name}</span>}
    <div className="cm-line" data-side={mine ? 'me' : 'them'} data-ai={ai} data-status={message.status}>
      {mine ? null : ai ? <AiMark label={`${contact.name}的 Plasticine`} /> : avatar}
      <div className="cm-message-content">
        {mine ? null : gallery}
        {message.text === '' && message.mention == null ? null :
          <div className={ai ? 'cm-ai-text' : 'cm-bubble'}>{text}</div>}
        {mine ? gallery : null}
        {message.status === 'sending' ? <span className="text-meta" role="status">正在发送</span> : null}
        {message.status !== 'failed' ? null : <div className="contact-media-error" role="alert">
          没发出：{message.error ?? '发送未完成'}<button type="button" className="text-button" disabled={busy}
            onClick={() => void retry()}>重试发送</button></div>}
        {error === null ? null : <div className="contact-media-error" role="alert">{error}
          <button type="button" className="text-button" onClick={() => { setError(null); setRevision(revision + 1); }}>
            重试读取</button></div>}
      </div>
      {mine && ai ? <AiMark label="你的 Plasticine" /> : null}
    </div>
  </div>;
}
