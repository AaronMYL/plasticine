// Note metadata (《实施方案》第 4 节迁移规则 5): the text of a note stays a file in the state directory's notes/,
// only its metadata is a row. The row records the file's byte count and SHA-256 so a copy can be checked.
// Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { HashSchema } from './state-access.ts';
import { IdSchema, IsoTimeSchema, Nullable, OBJECT_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

// The old notebook's limit per note (1ca0391 agent/src/notes.ts): migrated notes all fit, new ones keep it.
export const NOTE_MAX_CHARS = 400_000;
// Old user folders were at most 40 characters; project folders carried their topic id, which can be longer.
export const NOTE_FOLDER_MAX_CHARS = 100;
export const DEFAULT_NOTE_FOLDER = '笔记';
export const NOTE_AUTHORS = ['user', 'ai'] as const;

export const NoteFolderSchema = Type.String({ minLength: 1, maxLength: NOTE_FOLDER_MAX_CHARS });
export const NoteMarkdownSchema = Type.String({ maxLength: NOTE_MAX_CHARS });

export const NoteInputSchema = Type.Object(
  {
    markdown: NoteMarkdownSchema,
    folder: NoteFolderSchema,
    author: Type.Enum(NOTE_AUTHORS),
    pinned: Type.Optional(Type.Boolean()),
    // Private notes stay out of the conversation context (old behaviour).
    private: Type.Optional(Type.Boolean()),
    // Originals kept after a merge in the old notebook: readable, never edited.
    readOnly: Type.Optional(Type.Boolean()),
  },
  STRICT,
);
export type NoteInput = Static<typeof NoteInputSchema>;

export const NotePatchSchema = Type.Partial(
  Type.Object({
    markdown: NoteMarkdownSchema,
    folder: NoteFolderSchema,
    pinned: Type.Boolean(),
    restoredFromVersion: Type.Integer({ minimum: 1 }),
  }),
  STRICT,
);
export type NotePatch = Static<typeof NotePatchSchema>;

/** Import only: keep the old note's own created / updated times and the migration markers. */
export const NoteCreateOptionsSchema = Type.Object(
  {
    id: Type.Optional(IdSchema),
    createdAt: Type.Optional(IsoTimeSchema),
    updatedAt: Type.Optional(IsoTimeSchema),
    migratedDefault: Type.Optional(Type.Boolean()),
    legacyPayload: Type.Optional(Type.Unknown()),
  },
  STRICT,
);
export type NoteCreateOptions = Static<typeof NoteCreateOptionsSchema>;

export const NoteRecordSchema = Type.Object({
  ...OBJECT_META,
  title: Type.String({ minLength: 1 }),
  folder: NoteFolderSchema,
  pinned: Type.Boolean(),
  private: Type.Boolean(),
  readOnly: Type.Boolean(),
  author: Type.Enum(NOTE_AUTHORS),
  preview: Type.String(),
  bodyFile: Type.String({ minLength: 1 }),
  bodyBytes: Type.Integer({ minimum: 0 }),
  bodySha256: HashSchema,
  // Deleting a note only sets this; the row and the file stay (不删任何现有数据).
  deletedAt: Nullable(IsoTimeSchema),
});
export type NoteRecord = Static<typeof NoteRecordSchema>;

/**
 * 笔记正文的一个版本（review-followups e4cef52：先覆盖正文再提交版本，失败时旧版本号对应新正文）。每次保存写一个新
 * 的版本文件，事务里改行上的指针并记一行版本；旧文件留着，就是笔记的「版本」。
 */
export const NoteVersionSchema = Type.Object(
  {
    noteId: IdSchema,
    version: Type.Integer({ minimum: 1 }),
    bodyFile: Type.String({ minLength: 1 }),
    bodyBytes: Type.Integer({ minimum: 0 }),
    bodySha256: HashSchema,
    author: Type.Enum(['user', 'ai']),
    savedAt: IsoTimeSchema,
    restoredFromVersion: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  },
  STRICT,
);
export type NoteVersion = Static<typeof NoteVersionSchema>;
