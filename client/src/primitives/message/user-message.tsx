// 你的话：右对齐的 --tint 气泡。还没拿到回执时，气泡下面一行写状态和能做的事：
// 结果待核实 → 「再核实」（同一标识去查，不重发）；没送到 / 失败 → 「重发」「放回输入框」。

import type { ReactNode } from 'react';
import type { QuoteChip } from '../../api/types.ts';
import { USER_STATE_TEXT, type UserState } from './states.ts';
import { QuoteSelection } from './quote-selection.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { CopyMessage } from './copy-message.tsx';
import { QuotePreview } from './quote-preview.tsx';

export interface UserMessageProps {
  attachments?: ReactNode;
  /** 你发的图片和部件（设计稿 2026-11-03）：排在气泡下面，图片一格一格。 */
  widgets?: ReactNode;
  text: string;
  quotes: QuoteChip[];
  state: UserState;
  error?: string | null | undefined;
  onVerify?: (() => void) | undefined;
  onResend?: (() => void) | undefined;
  onDiscard?: (() => void) | undefined;
  onQuote?: ((text: string) => void) | undefined;
  /** 这句是回复哪一条的（「回复 Plasticine：……」，《优化清单》第 17 条）。 */
  replyTo?: { author: string; text: string } | null | undefined;
}

/** 引用了书的那一句下面写一行「归入 · 《书名》 · 讨论」：这本书的「讨论」tab 会收着它。 */
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
        {USER_STATE_TEXT[props.state]}
      </span>
      {props.error ? <span className="msg-user-status-reason">{props.error}</span> : null}
      {props.state === 'uncertain' && props.onVerify ? (
        <button type="button" className="msg-link" onClick={props.onVerify}>
          再核实
        </button>
      ) : null}
      {(props.state === 'unsent' || props.state === 'failed') && props.onResend ? (
        <button type="button" className="msg-link" onClick={props.onResend}>
          重发
        </button>
      ) : null}
      {(props.state === 'unsent' || props.state === 'failed') && props.onDiscard ? (
        <button type="button" className="msg-link" onClick={props.onDiscard}>
          放回输入框
        </button>
      ) : null}
    </div>
  );
}

/**
 * 复制、引用排在气泡左边、和气泡同一行（2026-11-04：原来在气泡下面另起一行，往上又找不到能悬停的「一行」——电脑上
 * 永远不出现、却空占一行，看不见也点得到）。整条消息是悬停范围（reveal-scope），和 Plasticine 的回复（article）一样
 * 悬停或键盘焦点进来才出现；触屏照旧常显，手机对话里不带这一排（styles.css）。没有气泡就没有可复制的话，不出这一排。
 */
export function UserMessage(props: UserMessageProps): ReactNode {
  const empty = props.text === '' && props.quotes.length === 0 && props.attachments == null;
  return (
    <div className="msg msg-user reveal-scope" data-state={props.state}>
      {empty ? null : <div className="msg-user-line">
        <div className="msg-actions msg-user-actions reveal-hover">
          <CopyMessage text={props.text} />
          {props.onQuote === undefined ? null : <IconButton icon="quote" label="引用这句话"
            className="msg-icon msg-quiet" onClick={() => props.onQuote?.(props.text)} />}
        </div>
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
                <QuotePreview key={quote.id} quote={quote} />
              ))}
            </div>
          ) : null}
          <QuoteSelection onQuote={props.onQuote}><div className="msg-text">{props.text}</div></QuoteSelection>
          {props.attachments}
        </div>
      </div>}
      {props.widgets}
      <StatusLine {...props} />
      {props.state === 'sent' && bookArchive(props.quotes) !== null ? (
        <p className="msg-book-archive text-meta">{bookArchive(props.quotes)}</p>
      ) : null}
    </div>
  );
}
