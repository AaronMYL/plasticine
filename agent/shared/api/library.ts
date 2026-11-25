import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema } from './common.ts';
import { OrNull } from './lineage.ts';

export const LIBRARY_TRASH_PATH = `${API_PREFIX}/library/trash`;

export const LIBRARY_TRASH_KINDS = ['space', 'book', 'file', 'folder'] as const;
export type LibraryTrashKind = (typeof LIBRARY_TRASH_KINDS)[number];

export const LibraryTrashItemSchema = Type.Object({
  kind: Type.Enum(LIBRARY_TRASH_KINDS),
  id: Type.String({ minLength: 1 }),
  title: Type.String(),
  deletedAt: IsoTimeSchema,
  originalPath: OrNull(Type.String()),
  fileCount: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });
export type LibraryTrashItem = Static<typeof LibraryTrashItemSchema>;

export const LibraryTrashResponseSchema = Type.Object({ items: Type.Array(LibraryTrashItemSchema) },
  { additionalProperties: false });
export type LibraryTrashResponse = Static<typeof LibraryTrashResponseSchema>;
