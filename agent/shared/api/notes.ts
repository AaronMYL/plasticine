// /v2/notes: list, read one, create, save (with the version the editor started from; a mismatch is 409 with the
// current note) and delete (sets the deletion time; the file stays). The text is Markdown, as in the old notebook.

import { Type, type Static } from 'typebox';
import { NOTE_AUTHORS, NoteFolderSchema, NoteMarkdownSchema } from '../state.ts';
import { API_PREFIX, ApiErrorSchema, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';

export const NOTES_PATH = `${API_PREFIX}/notes`;
export const NOTE_ASSETS_PATH = `${NOTES_PATH}/assets`;
/** 旧客户端兼容，无副作用；认证会话直接可读笔记，不需要调用此接口。 */
export const UnlockNoteRequestSchema = Type.Object(
  { requestId: RequestIdSchema }, { additionalProperties: false },
);
export const UnlockNoteResponseSchema = Type.Object({ unlocked: Type.Literal(true) });
/**
 * Migrated notes keep their text byte for byte (迁移规则 5), so their pictures still point at the old path. The
 * client maps it with `currentAssetUrl`; the server stores and returns the text unchanged.
 */
export const LEGACY_NOTE_ASSETS_PATH = '/v1/notes/assets';

export function currentAssetUrl(src: string): string {
  const at = src.indexOf(`${LEGACY_NOTE_ASSETS_PATH}/`);
  return at === -1 ? src : `${NOTE_ASSETS_PATH}/${src.slice(at + LEGACY_NOTE_ASSETS_PATH.length + 1)}`;
}

// One page holds every note the old notebook had (175 live) with room to grow; one more is fetched to see if
// another page follows, and the state service's page limit is 500.
export const NOTE_LIST_MAX = 400;

export const NoteMetaViewSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  folder: Type.String(),
  pinned: Type.Boolean(),
  private: Type.Boolean(),
  readOnly: Type.Boolean(),
  author: Type.Enum(NOTE_AUTHORS),
  preview: Type.String(),
  bytes: Type.Integer({ minimum: 0 }),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 1 }),
  deletedAt: Type.Union([IsoTimeSchema, Type.Null()]),
  /** Came over from the old notebook. */
  migrated: Type.Boolean(),
  mergedCount: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type NoteMetaView = Static<typeof NoteMetaViewSchema>;

export const NoteViewSchema = Type.Object({ ...NoteMetaViewSchema.properties, markdown: Type.String() });
export type NoteView = Static<typeof NoteViewSchema>;

/** GET /v2/notes?folder=&includeDeleted=&limit=&offset= (query text: includeDeleted is `true` / `false`). */
export const NoteListQuerySchema = Type.Object(
  {
    folder: Type.Optional(NoteFolderSchema),
    q: Type.Optional(Type.String()),
    deletedOnly: Type.Optional(Type.Boolean()),
    includeDeleted: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: NOTE_LIST_MAX })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type NoteListQuery = Static<typeof NoteListQuerySchema>;

export const NoteListResponseSchema = Type.Object({
  notes: Type.Array(NoteMetaViewSchema),
  nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
});
export type NoteListResponse = Static<typeof NoteListResponseSchema>;

/** POST /v2/notes → 201 NoteView. Folder defaults to 笔记. */
export const CreateNoteRequestSchema = Type.Object(
  { requestId: RequestIdSchema, markdown: NoteMarkdownSchema, folder: Type.Optional(NoteFolderSchema) },
  { additionalProperties: false },
);
export type CreateNoteRequest = Static<typeof CreateNoteRequestSchema>;

/** PUT /v2/notes/:id → 200 NoteView, or 409 NoteConflict. */
export const SaveNoteRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 1 }),
    markdown: Type.Optional(NoteMarkdownSchema),
    folder: Type.Optional(NoteFolderSchema),
    pinned: Type.Optional(Type.Boolean()),
    restoredFromVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
export type SaveNoteRequest = Static<typeof SaveNoteRequestSchema>;

/** DELETE /v2/notes/:id → 200 NoteView with deletedAt set. Deleting again answers the same. */
export const DeleteNoteRequestSchema = Type.Object(
  { requestId: RequestIdSchema },
  { additionalProperties: false },
);
export type DeleteNoteRequest = Static<typeof DeleteNoteRequestSchema>;

/**
 * GET /v2/notes/:id/versions — saved versions, newest first (M5: every save keeps its own body file). Notes saved
 * before M5 list versions from then on.
 */
export const NoteVersionViewSchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  bytes: Type.Integer({ minimum: 0 }),
  characters: Type.Optional(Type.Integer({ minimum: 0 })),
  author: Type.Enum(NOTE_AUTHORS),
  savedAt: IsoTimeSchema,
  restoredFromVersion: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
});
export type NoteVersionView = Static<typeof NoteVersionViewSchema>;
export const NoteVersionListResponseSchema = Type.Object({ versions: Type.Array(NoteVersionViewSchema) });
export type NoteVersionListResponse = Static<typeof NoteVersionListResponseSchema>;
/** GET /v2/notes/:id/versions/:version — that version's text (read only; to go back, save it as the new text). */
export const NoteVersionTextSchema = Type.Object({ ...NoteVersionViewSchema.properties, markdown: Type.String() });
export type NoteVersionText = Static<typeof NoteVersionTextSchema>;

/** 409 on save: the note changed since the editor loaded it; `current` is what is stored now. */
export const NoteConflictSchema = Type.Object({ ...ApiErrorSchema.properties, current: NoteViewSchema });
export type NoteConflict = Static<typeof NoteConflictSchema>;
