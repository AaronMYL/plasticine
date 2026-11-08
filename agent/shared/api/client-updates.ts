import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
const STRICT = { additionalProperties: false };
export const ClientManifestSchema = Type.Object(
  {
    buildId: Type.String({ minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9._-]+$' }),
    builtAt: IsoTimeSchema,
    protocol: Type.Object({ min: Type.Integer({ minimum: 1 }), max: Type.Integer({ minimum: 1 }) }, STRICT),
    summary: Type.String({ minLength: 1, maxLength: 1000 }),
    assets: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1, maxLength: 300 }),
          bytes: Type.Integer({ minimum: 0 }),
          sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
        },
        STRICT,
      ),
      { minItems: 1, maxItems: 1000 },
    ),
  },
  STRICT,
);
export type ClientManifest = Static<typeof ClientManifestSchema>;
export const ClientPublicationSchema = Type.Object(
  {
    id: IdSchema,
    buildId: IdSchema,
    manifestDigest: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    publishedAt: IsoTimeSchema,
    previousBuildId: Type.Union([IdSchema, Type.Null()]),
    kind: Type.Enum(['publish', 'rollback']),
  },
  STRICT,
);
export type ClientPublication = Static<typeof ClientPublicationSchema>;
export const ClientUpdateSchema = Type.Object(
  {
    manifest: ClientManifestSchema,
    status: Type.Enum(['candidate', 'queued', 'published', 'deferred']),
    selfChangeId: Type.Union([IdSchema, Type.Null()]),
    taskId: Type.Union([IdSchema, Type.Null()]),
  },
  STRICT,
);
export type ClientUpdate = Static<typeof ClientUpdateSchema>;
export const ClientUpdatesResponseSchema = Type.Object(
  {
    current: Type.Union([ClientManifestSchema, Type.Null()]),
    updates: Type.Array(ClientUpdateSchema),
    history: Type.Array(ClientPublicationSchema),
    channelReady: Type.Boolean(),
    error: Type.Union([Type.String(), Type.Null()]),
  },
  STRICT,
);
export type ClientUpdatesResponse = Static<typeof ClientUpdatesResponseSchema>;
export const ClientUpdateDecisionSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    currentBuildId: Type.Union([IdSchema, Type.Null()]),
    targetBuildId: IdSchema,
    decision: Type.Enum(['publish', 'rollback', 'defer']),
  },
  STRICT,
);
export type ClientUpdateDecision = Static<typeof ClientUpdateDecisionSchema>;
