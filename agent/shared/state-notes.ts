import { Type, type Static } from 'typebox';
import { HashSchema } from './state-access.ts';
import { IdSchema, IsoTimeSchema, Nullable, OBJECT_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

export const NOTE_MAX_CHARS = 400_000;
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
  readOnly: Type.Boolean(),
  author: Type.Enum(NOTE_AUTHORS),
  preview: Type.String(),
  bodyFile: Type.String({ minLength: 1 }),
  bodyBytes: Type.Integer({ minimum: 0 }),
  bodySha256: HashSchema,
  deletedAt: Nullable(IsoTimeSchema),
});
export type NoteRecord = Static<typeof NoteRecordSchema>;

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
