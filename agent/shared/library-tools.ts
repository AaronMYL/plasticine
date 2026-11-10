import { Type } from 'typebox';
import { BatchItemSchema, BATCH_ACTIONS, BATCH_LIMIT } from './api/library-batch.ts';
import { IdSchema } from './api/common.ts';
import { NOTE_MAX_CHARS } from './state.ts';

const STRICT = { additionalProperties: false };
export const LibraryListParameters = Type.Object({
  deleted: Type.Optional(Type.Boolean()), path: Type.Optional(Type.String({ maxLength: 4000 })),
}, STRICT);
export const LibraryBatchParameters = Type.Object({
  action: Type.Enum(BATCH_ACTIONS),
  items: Type.Array(BatchItemSchema, { minItems: 1, maxItems: BATCH_LIMIT }),
  destination: Type.Optional(Type.String({ maxLength: 4000 })),
}, STRICT);
export const NoteCreateParameters = Type.Object({
  markdown: Type.String({ minLength: 1, maxLength: NOTE_MAX_CHARS }),
  folder: Type.Optional(Type.String({ maxLength: 4000 })),
}, STRICT);
export const NoteUpdateParameters = Type.Object({
  id: IdSchema, version: Type.Integer({ minimum: 1 }),
  markdown: Type.String({ maxLength: NOTE_MAX_CHARS }),
}, STRICT);
export const LibraryObjectParameters = Type.Object({ id: IdSchema }, STRICT);
export const NoteMoveParameters = Type.Object({ id: IdSchema, folder: Type.String({ maxLength: 4000 }) }, STRICT);
