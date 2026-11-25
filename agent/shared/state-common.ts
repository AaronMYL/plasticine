// SPDX-License-Identifier: Apache-2.0

import { Type, type Static, type TSchema } from 'typebox';

/** A column that may be NULL in the database. */
export function Nullable<T extends TSchema>(schema: T) {
  return Type.Union([schema, Type.Null()]);
}

export const IdSchema = Type.String({ minLength: 1 });
export const IsoTimeSchema = Type.String({ minLength: 1, format: 'date-time' });

export const ACTORS = ['user', 'brain', 'hand', 'system', 'migration'] as const;
export const ActorSchema = Type.Enum(ACTORS);
export type Actor = Static<typeof ActorSchema>;

export const REASON_KINDS = [
  'new_evidence',
  'reasoning_fix',
  'premise_clarified',
  'context_changed',
  'user_correction',
] as const;
export const ReasonKindSchema = Type.Enum(REASON_KINDS);
export type ReasonKind = Static<typeof ReasonKindSchema>;

export const OBJECT_TYPES = [
  'concern',
  'judgment',
  'evidence',
  'agreement',
  'task',
  'memory_entry',
  'source',
] as const;
export const ObjectTypeSchema = Type.Enum(OBJECT_TYPES);
export type ObjectType = Static<typeof ObjectTypeSchema>;

/** Columns on every mutable row: optimistic version starts at 1 and grows by one per change. */
export const RECORD_META = {
  id: IdSchema,
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 1 }),
};

export const MIGRATION_META = {
  migratedDefault: Type.Boolean(),
  legacyPayload: Nullable(Type.Unknown()),
};

export const OBJECT_META = { ...RECORD_META, ...MIGRATION_META };

/** Who last confirmed a user-confirmed field, from which paired device. Both null or both set. */
export const CONFIRMATION_META = {
  confirmedByDeviceId: Nullable(IdSchema),
  confirmedByDeviceAt: Nullable(IsoTimeSchema),
};

/**
 * A user-confirmed write's paired device and server time. app/ derives both from the live user session;
 * system sessions cannot supply this confirmation. Historical confirmations keep their original values.
 */
export const DeviceConfirmationSchema = Type.Object(
  {
    deviceId: IdSchema,
    confirmedAt: IsoTimeSchema,
  },
  { additionalProperties: false },
);
export type DeviceConfirmation = Static<typeof DeviceConfirmationSchema>;

export const ChangeSchema = Type.Object(
  {
    actor: ActorSchema,
    actorRef: Type.Optional(IdSchema),
    reason: Type.String({ minLength: 1 }),
    reasonKind: Type.Optional(ReasonKindSchema),
  },
  { additionalProperties: false },
);
export type Change = Static<typeof ChangeSchema>;

/** One row of `versions`: the object as it was right after the change, minus its legacy payload. */
export const VersionEntrySchema = Type.Object({
  id: IdSchema,
  objectType: ObjectTypeSchema,
  objectId: IdSchema,
  version: Type.Integer({ minimum: 1 }),
  actor: ActorSchema,
  actorRef: Nullable(IdSchema),
  reason: Type.String(),
  reasonKind: Nullable(ReasonKindSchema),
  fields: Type.Array(Type.String()),
  snapshot: Type.Record(Type.String(), Type.Unknown()),
  confirmedByDeviceId: Nullable(IdSchema),
  confirmedByDeviceAt: Nullable(IsoTimeSchema),
  migratedDefault: Type.Boolean(),
  legacyPayload: Nullable(Type.Unknown()),
  createdAt: IsoTimeSchema,
});
export type VersionEntry = Static<typeof VersionEntrySchema>;

/** Optional settings when creating a row: a caller-chosen id (import), or the migration markers. */
export const CreateOptionsSchema = Type.Object(
  {
    id: Type.Optional(IdSchema),
    migratedDefault: Type.Optional(Type.Boolean()),
    legacyPayload: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);
export type CreateOptions = Static<typeof CreateOptionsSchema>;

export const PageSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type Page = Static<typeof PageSchema>;

export const WORKSPACE_PATH_MAX_CHARS = 1_000;
export const WorkspacePathSchema = Type.String({ minLength: 1, maxLength: WORKSPACE_PATH_MAX_CHARS });
