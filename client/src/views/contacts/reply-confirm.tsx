import { useState, type ReactNode } from 'react';
import type { AskView, ContactRow } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { WaitMark } from '../../shell/wait-mark.tsx';
import { AskPlaceProvider, useAnswerAsk } from '../asks/ask-context.tsx';
import './reply-confirm.css';

export function replyAsksOf(open: readonly AskView[], contact: Pick<ContactRow, 'id' | 'kind'>): AskView[] {
  return open.filter((ask) => ask.networkReply !== undefined
    && (contact.kind === 'group' ? ask.networkReply.groupId : ask.networkReply.contactId) === contact.id);
}

function ReplyConfirmCard({ ask, name, group, onSelf }: { ask: AskView; name: string; group: boolean;
  onSelf: () => void }): ReactNode {
  const live = useLive();
  const answerAsk = useAnswerAsk();
  const work = useStore(live.asks.store).work.get(ask.id);
  const draft = ask.networkReply?.draft ?? null;
  const [text, setText] = useState(draft ?? '');
  const busy = work?.busy === true;
  const send = (): void => {
    const edited = text.trim();
    void answerAsk(ask, { optionId: 'send', ...(edited !== '' && edited !== draft ? { text: edited } : {}) });
  };
  const self = (): void => {
    void answerAsk(ask, { optionId: 'self' });
    onSelf();
  };
  if (ask.networkReply?.self === true) {
    return (
      <section className="reply-confirm" aria-label="等你确认发不发">
        <p className="reply-confirm-head">
          <WaitMark />
          Plasticine 想替你这样发，只有你看得到：
        </p>
        <textarea className="field-input reply-confirm-draft" aria-label="要发的话" rows={2} value={text}
          disabled={busy} maxLength={2000} onChange={(event) => setText(event.target.value)} />
        <div className="reply-confirm-actions">
          <button type="button" className="primary-button" disabled={busy || text.trim() === ''}
            onClick={send}>这样发</button>
          <button type="button" className="secondary-button" disabled={busy}
            onClick={() => void answerAsk(ask, { optionId: 'none' })}>不发</button>
        </div>
        {work?.error == null ? null : <p className="block-empty is-error" role="alert">{work.error}</p>}
      </section>
    );
  }
  return (
    <section className="reply-confirm" aria-label={`等你确认怎么回${name}`}>
      <p className="reply-confirm-head">
        <WaitMark />
        {group ? (draft === null ? 'Plasticine 没有把握回这句，等你来回。' : 'Plasticine 拿不准，想这样回：')
          : draft === null ? `Plasticine 没有把握回${name}，等你来回。` : `Plasticine 拿不准，想这样回${name}：`}
      </p>
      {group ? <p className="reply-confirm-question">{ask.question}</p> : null}
      {draft === null ? null : (
        <textarea className="field-input reply-confirm-draft" aria-label="回复草稿" rows={2} value={text} disabled={busy}
          maxLength={2000} onChange={(event) => setText(event.target.value)} />
      )}
      <div className="reply-confirm-actions">
        {draft === null ? null : <button type="button" className="primary-button" disabled={busy || text.trim() === ''}
          onClick={send}>这样回</button>}
        <button type="button" className={draft === null ? 'primary-button' : 'secondary-button'} disabled={busy}
          onClick={self}>我自己回</button>
        <button type="button" className="secondary-button" disabled={busy}
          onClick={() => void answerAsk(ask, { optionId: 'none' })}>不回</button>
      </div>
      {work?.error == null ? null : <p className="block-empty is-error" role="alert">{work.error}</p>}
    </section>
  );
}

export function ReplyConfirms({ contact, onSelf }: { contact: ContactRow; onSelf: () => void }): ReactNode {
  const live = useLive();
  const asks = replyAsksOf(useStore(live.asks.store).open, contact);
  const place = contact.kind === 'group' ? { kind: 'chat' as const, contactId: null, groupId: contact.id }
    : { kind: 'chat' as const, contactId: contact.id, groupId: null };
  return <AskPlaceProvider place={place}>
    {asks.map((ask) => <ReplyConfirmCard key={ask.id} ask={ask} name={contact.name}
      group={contact.kind === 'group'} onSelf={onSelf} />)}
  </AskPlaceProvider>;
}
