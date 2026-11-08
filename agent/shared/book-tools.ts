// 脑读书用的工具参数（图书，2026-11-01）：列出图书馆、在书里找、读一章、读用户的标注。

import { Type } from 'typebox';

export const BookListParameters = Type.Object({}, { additionalProperties: false });
export const BookSearchParameters = Type.Object({
  bookId: Type.String({ minLength: 1 }),
  q: Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: false });
export const BookReadParameters = Type.Object({
  bookId: Type.String({ minLength: 1 }),
  chapter: Type.Integer({ minimum: 0 }),
  // 长章分段读：从第几个字开始（按纯文字算）。
  from: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });
export const BookAnnotationsParameters = Type.Object({
  bookId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
