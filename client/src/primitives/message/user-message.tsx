import { Fragment, type ReactNode } from 'react';
import type { QuoteChip } from '../../api/types.ts';
import { USER_STATE_TEXT, type UserState } from './states.ts';
import { QuoteSelection } from './quote-selection.tsx';
import { Icon } from '../../shell/icons.tsx';
import { CopyMessage } from './copy-message.tsx';
import { QuotePreview } from './quote-preview.tsx';

export interface UserMessageProps {
  attachments?: ReactNode;
  widgets?: ReactNode;
  text: string;
  content?: ReactNode;
  quotes: QuoteChip[];
  state: UserState;
  error?: string | null | undefined;
  onVerify?: (() => void) | undefined;
  onResend?: (() => void) | undefined;
  onDiscard?: (() => void) | undefined;
  onQuote?: ((text: string) => void) | undefined;
  replyTo?: { author: string; text: string } | null | undefined;
  renderQuote?: ((quote: QuoteChip) => ReactNode | null) | undefined;
}

function bookArchive(quotes: readonly QuoteChip[]): string | null {
  const book = quotes.find((quote) => quote.bookReference !== undefined);
  if (book === undefined) {
    return null;
  }
  const title = /《[^》]*》/.exec(book.label)?.[0] ?? '这本书';
  return `归入 · ${title} · 讨论`;
}

function StatusLine(props: UserMessageProps): ReactNode {
  if (props.state === 'sent') {
    return null;
  }
  const isError = props.state === 'failed';
  return (
    <div className="msg-user-status" role="status">
      <span className={isError ? 'msg-user-status-text is-error' : 'msg-user-status-text'}>
        {isError ? `没发出：${props.error ?? '连接中断'}` : USER_STATE_TEXT[props.state]}
      </span>
      {props.error && !isError ? <span className="msg-user-status-reason">{props.error}</span> : null}
      {props.state === 'uncertain' && props.onVerify ? (
        <button type="button" className="msg-link" onClick={props.onVerify}>
          再核实
        </button>
      ) : null}
      {(props.state === 'unsent' || props.state === 'failed') && props.onResend ? (
        <button type="button" className="msg-link" onClick={props.onResend}>
          {isError ? '重试' : '重发'}
        </button>
      ) : null}
      {(props.state === 'unsent' || props.state === 'failed') && props.onDiscard ? (
        <button type="button" className="msg-link" onClick={props.onDiscard}>
          放回输入框
        </button>
      ) : null}
      {props.text === '' ? null : <CopyMessage text={props.text} />}
    </div>
  );
}

export function UserMessage(props: UserMessageProps): ReactNode {
  const empty = props.text === '' && props.quotes.length === 0;
  return (
    <div className="msg msg-user" data-state={props.state}>
      {props.attachments}
      {empty ? null : (
        <div className="msg-bubble">
          {props.replyTo == null ? null : (
            <div className="msg-reply">
              <Icon name="reply" size={12} />
              <span className="msg-reply-text">回复 {props.replyTo.author}：{props.replyTo.text}</span>
            </div>
          )}
          {props.quotes.length > 0 ? (
            <div className="msg-quotes">
              {props.quotes.map((quote) => (
                <Fragment key={quote.id}>{props.renderQuote?.(quote) ?? <QuotePreview quote={quote} />}</Fragment>
              ))}
            </div>
          ) : null}
          <QuoteSelection onQuote={props.onQuote}>{props.content ?? <div className="msg-text">{props.text}</div>}
          </QuoteSelection>
        </div>
      )}
      {props.widgets}
      <StatusLine {...props} />
      {props.state === 'sent' && bookArchive(props.quotes) !== null ? (
        <p className="msg-book-archive text-meta">{bookArchive(props.quotes)}</p>
      ) : null}
    </div>
  );
}
