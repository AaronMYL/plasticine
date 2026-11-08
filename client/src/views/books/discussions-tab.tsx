// 「讨论」tab：主对话里引用过这本书的那几轮（服务端从消息里的书引用认出来），点「回到对话 ›」回到那条消息接着聊。

import type { ReactNode } from 'react';
import type { BookDiscussion, BookTocEntry } from '../../api/shared.ts';
import { chapterShort, readingTime } from './book-format.ts';

export interface DiscussionsTabProps {
  discussions: readonly BookDiscussion[] | null;
  error: string | null;
  toc: readonly BookTocEntry[];
  now: Date;
  onOpen: (discussion: BookDiscussion) => void;
  onJump: (discussion: BookDiscussion) => void;
}

export function DiscussionsTab(props: DiscussionsTabProps): ReactNode {
  if (props.error !== null) {
    return <p className="block-empty is-error" role="alert">{props.error}</p>;
  }
  if (props.discussions === null) {
    return <p className="block-empty">正在读…</p>;
  }
  return (
    <>
      <p className="block-empty">在主对话里引用了这本书的那几轮，会自动收在这里；点开回到对话里那一处，接着聊。</p>
      {props.discussions.length === 0 ? <p className="block-empty">还没有讨论，选中一段点「引用到对话」就有了。</p> : null}
      <ul className="bk-disc-list">
        {props.discussions.map((discussion) => (
          <li key={discussion.messageId} className="bk-disc">
            <p className="bk-disc-q">{discussion.question === '' ? discussion.quoteLabel : discussion.question}</p>
            {discussion.answer === null ? null : <p className="bk-disc-a">{discussion.answer}</p>}
            <div className="bk-ann-meta text-meta">
              <button type="button" className="text-button text-button-quiet" onClick={() => props.onJump(discussion)}>
                {chapterShort(props.toc[discussion.chapter]?.title ?? discussion.quoteLabel)}
              </button>
              <span>{readingTime(discussion.at, props.now)}</span>
              <span className="grow" />
              <button type="button" className="text-button" onClick={() => props.onOpen(discussion)}>回到对话 ›</button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
