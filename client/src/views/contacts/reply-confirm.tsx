// 聊天里的确认卡（11-12 全量优化第 5 条，Aaron：「AI 直接在对话框中让我确认，别再让我去『任务-等你』中确认」）。
// 别人 @ 了我的 Plasticine、它拿不准时，要我定怎么回的那张卡直接出在这段聊天的最后：草稿可以先改再发；
// 「我自己回」把光标交给下面的输入框；「不回」什么都不发。卡只有我看得到，答了（哪台设备上答的都算）就收起。

import { useState, type ReactNode } from 'react';
import type { AskView, ContactRow } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { Icon } from '../../shell/icons.tsx';
import './reply-confirm.css';

/** 这段聊天里还开着的确认卡。 */
export function replyAsksOf(open: readonly AskView[], contact: Pick<ContactRow, 'id' | 'kind'>): AskView[] {
  return open.filter((ask) => ask.networkReply !== undefined
    && (contact.kind === 'group' ? ask.networkReply.groupId : ask.networkReply.contactId) === contact.id);
}

function ReplyConfirmCard({ ask, name, onSelf }: { ask: AskView; name: string; onSelf: () => void }): ReactNode {
  const live = useLive();
  const work = useStore(live.asks.store).work.get(ask.id);
  const draft = ask.networkReply?.draft ?? null;
  const [text, setText] = useState(draft ?? '');
  const busy = work?.busy === true;
  const send = (): void => {
    const edited = text.trim();
    void live.asks.answer(ask, { optionId: 'send', ...(edited !== '' && edited !== draft ? { text: edited } : {}) });
  };
  const self = (): void => {
    void live.asks.answer(ask, { optionId: 'self' });
    onSelf();
  };
  return (
    <section className="reply-confirm" aria-label={`等你确认怎么回${name}`}>
      <p className="reply-confirm-head">
        <span className="reply-confirm-tag"><Icon name="clock" size={13} />等你</span>
        {draft === null ? `Plasticine 没有把握回${name}，等你来回。` : `Plasticine 拿不准，想这样回${name}：`}
      </p>
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
          onClick={() => void live.asks.answer(ask, { optionId: 'none' })}>不回</button>
      </div>
      {work?.error == null ? null : <p className="block-empty is-error" role="alert">{work.error}</p>}
    </section>
  );
}

export function ReplyConfirms({ contact, onSelf }: { contact: ContactRow; onSelf: () => void }): ReactNode {
  const live = useLive();
  const asks = replyAsksOf(useStore(live.asks.store).open, contact);
  return asks.map((ask) => <ReplyConfirmCard key={ask.id} ask={ask} name={contact.name} onSelf={onSelf} />);
}
