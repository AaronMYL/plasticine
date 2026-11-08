// /v2/library/trash（2026-11-08 他定：资料库里的空间、图书、文件都能删，删了进「最近删除」能还原）：一次给齐三类删掉的，
// 按删除时间新的在前。还原各走各的接口（POST /v2/spaces/:id/restore、/v2/books/:id/restore、/v2/files/restore）。
// 没有永久删除（和笔记、文件一致）。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema } from './common.ts';
import { OrNull } from './lineage.ts';

export const LIBRARY_TRASH_PATH = `${API_PREFIX}/library/trash`;

export const LIBRARY_TRASH_KINDS = ['space', 'book', 'file'] as const;
export type LibraryTrashKind = (typeof LIBRARY_TRASH_KINDS)[number];

export const LibraryTrashItemSchema = Type.Object({
  kind: Type.Enum(LIBRARY_TRASH_KINDS),
  /** 空间、书的 id；文件是回收里的那一项（POST /v2/files/restore 的 id）。 */
  id: Type.String({ minLength: 1 }),
  title: Type.String(),
  deletedAt: IsoTimeSchema,
  /** 文件原来在哪（还原回那里）；空间和书是 null。 */
  originalPath: OrNull(Type.String()),
}, { additionalProperties: false });
export type LibraryTrashItem = Static<typeof LibraryTrashItemSchema>;

export const LibraryTrashResponseSchema = Type.Object({ items: Type.Array(LibraryTrashItemSchema) },
  { additionalProperties: false });
export type LibraryTrashResponse = Static<typeof LibraryTrashResponseSchema>;
