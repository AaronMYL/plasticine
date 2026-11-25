import { Type, type Static } from 'typebox';
import { IsoTimeSchema } from './common.ts';

const STRICT = { additionalProperties: false };

export const SITE_LOGINS_MAX = 500;

export const LOGIN_SOURCES = ['chrome', 'safari'] as const;
export const LoginSourceIdSchema = Type.Enum(LOGIN_SOURCES);
export type LoginSourceId = Static<typeof LoginSourceIdSchema>;

export const SiteLoginSchema = Type.Object({
  host: Type.String({ minLength: 1, maxLength: 253 }),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  password: Type.Boolean(),
  since: Type.Union([IsoTimeSchema, Type.Null()]),
}, STRICT);
export type SiteLogin = Static<typeof SiteLoginSchema>;

export const SiteLoginsSchema = Type.Object({
  sites: Type.Array(SiteLoginSchema, { maxItems: SITE_LOGINS_MAX }),
}, STRICT);
export type SiteLogins = Static<typeof SiteLoginsSchema>;

export const LoginSourceSchema = Type.Object({
  id: LoginSourceIdSchema,
  available: Type.Boolean(),
  profile: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
  sites: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  needs: Type.Union([Type.Literal('full_disk_access'), Type.Null()]),
  passwords: Type.Boolean(),
}, STRICT);
export type LoginSource = Static<typeof LoginSourceSchema>;

export const LoginSourcesSchema = Type.Object({ sources: Type.Array(LoginSourceSchema, { maxItems: 4 }) }, STRICT);
export type LoginSources = Static<typeof LoginSourcesSchema>;

export const LoginImportRequestSchema = Type.Object({
  from: LoginSourceIdSchema,
  passwords: Type.Boolean(),
}, STRICT);
export type LoginImportRequest = Static<typeof LoginImportRequestSchema>;

export const LoginImportResultSchema = Type.Object({
  sites: Type.Integer({ minimum: 0 }),
  cookies: Type.Integer({ minimum: 0 }),
  passwords: Type.Integer({ minimum: 0 }),
  skipped: Type.Integer({ minimum: 0 }),
  problem: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
}, STRICT);
export type LoginImportResult = Static<typeof LoginImportResultSchema>;

export interface PlasticineMacLogins {
  sites(): Promise<unknown>;
  sources(): Promise<unknown>;
  import(request: LoginImportRequest): Promise<unknown>;
  forget(host: string): Promise<unknown>;
  openFullDiskAccess(): void;
}
