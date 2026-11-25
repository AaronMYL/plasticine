import { Type } from 'typebox';

export const BookListParameters = Type.Object({}, { additionalProperties: false });
export const BookSearchParameters = Type.Object({
  bookId: Type.String({ minLength: 1 }),
  q: Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: false });
export const BookReadParameters = Type.Object({
  bookId: Type.String({ minLength: 1 }),
  chapter: Type.Integer({ minimum: 0 }),
  from: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });
export const BookAnnotationsParameters = Type.Object({
  bookId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
