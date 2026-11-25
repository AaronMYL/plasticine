import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { SOUL_TEXT_MAX_CHARS } from '../soul-text.ts';

export const SOULS_PATH = `${API_PREFIX}/souls`;
export const SOUL_OWNER_MAIN = 'main';
export const SOUL_ACTORS = ['user', 'self', 'system', 'move'] as const;
export type SoulActor = (typeof SOUL_ACTORS)[number];
export const SOUL_REVISIONS_SHOWN = 20;

export const SoulOwnerSchema = Type.Union([Type.Literal(SOUL_OWNER_MAIN), IdSchema]);

export const SoulDocSchema = Type.Object({
  owner: SoulOwnerSchema,
  text: Type.String({ maxLength: SOUL_TEXT_MAX_CHARS }),
  version: Type.Integer({ minimum: 1 }),
  updatedAt: IsoTimeSchema,
}, { additionalProperties: false });
export type SoulDoc = Static<typeof SoulDocSchema>;

export const SoulRevisionSchema = Type.Object({
  id: IdSchema,
  actor: Type.Enum(SOUL_ACTORS),
  note: Type.String({ maxLength: 300 }),
  at: IsoTimeSchema,
  changes: Type.Integer({ minimum: 0 }),
  undoneAt: Type.Union([IsoTimeSchema, Type.Null()]),
  undoes: Type.Union([IdSchema, Type.Null()]),
}, { additionalProperties: false });
export type SoulRevision = Static<typeof SoulRevisionSchema>;

export const SoulResponseSchema = Type.Object({
  soul: SoulDocSchema,
  revisions: Type.Array(SoulRevisionSchema, { maxItems: SOUL_REVISIONS_SHOWN }),
}, { additionalProperties: false });
export type SoulResponse = Static<typeof SoulResponseSchema>;

export const UpdateSoulRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  text: Type.String({ minLength: 1, maxLength: SOUL_TEXT_MAX_CHARS }),
}, { additionalProperties: false });
export type UpdateSoulRequest = Static<typeof UpdateSoulRequestSchema>;

export const UndoSoulRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  revisionId: IdSchema,
}, { additionalProperties: false });
export type UndoSoulRequest = Static<typeof UndoSoulRequestSchema>;

export const SoulDiffLineSchema = Type.Object({
  kind: Type.Enum(['same', 'add', 'remove']),
  text: Type.String(),
}, { additionalProperties: false });

export const SoulRevisionDiffResponseSchema = Type.Object({
  revision: SoulRevisionSchema,
  diff: Type.Array(SoulDiffLineSchema),
}, { additionalProperties: false });
export type SoulRevisionDiffResponse = Static<typeof SoulRevisionDiffResponseSchema>;
