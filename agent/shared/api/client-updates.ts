// SPDX-License-Identifier: Apache-2.0
import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema } from './common.ts';
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
/**
 * GET /v2/client-version（2026-11-12《首次使用解耦》）：界面只比版本号，不带整份资源清单（清单约 870 KB，原来每分钟
 * 一个窗口传一份）。protocol 留着：界面要看新版本跟不跟自己的接口版本兼容。
 */
export const ClientVersionSchema = Type.Object(
  {
    current: Type.Union([
      Type.Object(
        {
          buildId: ClientManifestSchema.properties.buildId,
          builtAt: IsoTimeSchema,
          protocol: ClientManifestSchema.properties.protocol,
          summary: ClientManifestSchema.properties.summary,
        },
        STRICT,
      ),
      Type.Null(),
    ]),
    error: Type.Union([Type.String(), Type.Null()]),
  },
  STRICT,
);
export type ClientVersion = Static<typeof ClientVersionSchema>;

/** 现在这一版的清单（没有就是 null）和读清单时的出错说明，收成界面要的那几样。 */
export function clientVersionOf(view: { current: ClientManifest | null; error: string | null }): ClientVersion {
  const current = view.current;
  return {
    current: current === null ? null : {
      buildId: current.buildId,
      builtAt: current.builtAt,
      protocol: { ...current.protocol },
      summary: current.summary,
    },
    error: view.error,
  };
}
