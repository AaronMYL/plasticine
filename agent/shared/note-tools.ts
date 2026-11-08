import { Type } from 'typebox';
import { NoteFolderSchema, NoteMarkdownSchema } from './state.ts';

export const NoteSearchParameters = Type.Object({ q: Type.String() }, { additionalProperties: false });
export const NoteReadParameters = Type.Object({ id: Type.String({ minLength: 1 }) }, { additionalProperties: false });
export const NoteWriteParameters = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1 })),
  title: Type.Optional(Type.String({ minLength: 1 })),
  markdown: NoteMarkdownSchema,
  version: Type.Optional(Type.Integer({ minimum: 1 })),
  folder: Type.Optional(NoteFolderSchema),
}, { additionalProperties: false });
