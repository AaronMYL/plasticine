// 封面：书里自带封面图就用它；没有（TXT、没带封面的 EPUB）画一张文字封面——书名（中文短书名竖排）、
// 一条细线、作者、右下角格式。底色只在一底一前景里取三种（--fg 实底 / --tint2 / 描边），按书的 id 固定一种。

import type { ReactNode } from 'react';
import type { BookView } from '../../api/shared.ts';
import { verticalTitle } from './book-format.ts';

const TONES = ['ink', 'plain', 'line'] as const;

function toneOf(id: string): (typeof TONES)[number] {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 997;
  }
  return TONES[hash % TONES.length] ?? 'plain';
}

type CoverBook = Pick<BookView, 'id' | 'title' | 'author' | 'format' | 'coverUrl'>;

export function BookCover({ book }: { book: CoverBook }): ReactNode {
  if (book.coverUrl !== null) {
    return (
      <div className="bk-cover bk-cover-image">
        <img src={book.coverUrl} alt={`《${book.title}》封面`} loading="lazy" />
      </div>
    );
  }
  return (
    <div className="bk-cover" data-tone={toneOf(book.id)} data-vertical={verticalTitle(book.title)}
      role="img" aria-label={`《${book.title}》文字封面`}>
      <span className="bk-cover-title" aria-hidden="true">{book.title}</span>
      <span className="bk-cover-foot" aria-hidden="true">
        <span className="bk-cover-rule" />
        <span className="bk-cover-author">{book.author ?? ''}</span>
      </span>
    </div>
  );
}
