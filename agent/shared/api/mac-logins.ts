// 各网站的登录（2026-11-04 第 3 批，他定）：在 Plasticine 的浏览器里登录一次就记住（网页标签共用的持久数据存储里的
// Cookie）；登录状态只在他的设备上，不进服务器。「导入登录…」= 从 Chrome / Safari 搬一次登录状态到 Plasticine 的浏览器。
// 2026-11-05 第 6 条（他定：全部不用钥匙串）：网站只记登录状态、不存密码，导入只导登录状态（Cookie）。下面带 password /
// passwords 的几个字段留着，让 0.6.0 及以前的 App 和新网页对得上：网页一律发 passwords: false、不再显示这些字段；
// 0.7.0 起的 App 一律回 false / 0。以前存进钥匙串的密码不删，只是不再读写。
//
// 全在本机做，只在他点「导入」时做：读 Chrome 的 Cookie 要钥匙串里的「Chrome Safe Storage」（系统弹框问他允不允许），
// 读 Safari 的 Cookie 要「完全磁盘访问」；不经服务器、不进日志。网页界面只拿到站点名、个数和结果（下面的形状），
// 拿不到 Cookie 的值。原生做法在 mac/Sources/Plasticine/login-*.swift。
//
// 网页 → 原生：window.plasticineMac.logins 的几个方法，经消息通道 `plasticineLogins`，只收本站主 frame 的消息，都要回执。

import { Type, type Static } from 'typebox';
import { IsoTimeSchema } from './common.ts';

const STRICT = { additionalProperties: false };

/** 一次最多列这么多个网站：再多是没清理过的 Cookie，不是登录。 */
export const SITE_LOGINS_MAX = 500;

export const LOGIN_SOURCES = ['chrome', 'safari'] as const;
export const LoginSourceIdSchema = Type.Enum(LOGIN_SOURCES);
export type LoginSourceId = Static<typeof LoginSourceIdSchema>;

/** 一个登录着的网站（按可注册域名归在一起）。 */
export const SiteLoginSchema = Type.Object({
  host: Type.String({ minLength: 1, maxLength: 253 }),
  /** 给人看的名字：站点的标题或域名的主干。 */
  name: Type.String({ minLength: 1, maxLength: 100 }),
  /** 已不用（第 6 条，不存密码）：0.7.0 起的 App 一律回 false，网页不显示；留着给旧 App 对得上。 */
  password: Type.Boolean(),
  /** 什么时候登录或导入的（Plasticine 自己记的）；不知道是 null。 */
  since: Type.Union([IsoTimeSchema, Type.Null()]),
}, STRICT);
export type SiteLogin = Static<typeof SiteLoginSchema>;

export const SiteLoginsSchema = Type.Object({
  sites: Type.Array(SiteLoginSchema, { maxItems: SITE_LOGINS_MAX }),
}, STRICT);
export type SiteLogins = Static<typeof SiteLoginsSchema>;

/** 能从哪儿导入：装没装、要什么权限才读得到。 */
export const LoginSourceSchema = Type.Object({
  id: LoginSourceIdSchema,
  /** 这台 Mac 上有这个浏览器的数据。 */
  available: Type.Boolean(),
  /** Chrome 的个人资料名（默认是「默认个人资料」）；Safari 是 null。 */
  profile: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
  /** 有 Cookie 的网站数；读不到（要权限）是 null。 */
  sites: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  /** 要他先给的权限：Safari 的 Cookie 要「完全磁盘访问」。 */
  needs: Type.Union([Type.Literal('full_disk_access'), Type.Null()]),
  /** 已不用（第 6 条，只导登录状态）：0.7.0 起的 App 一律回 false，网页不看；留着给旧 App 对得上。 */
  passwords: Type.Boolean(),
}, STRICT);
export type LoginSource = Static<typeof LoginSourceSchema>;

export const LoginSourcesSchema = Type.Object({ sources: Type.Array(LoginSourceSchema, { maxItems: 4 }) }, STRICT);
export type LoginSources = Static<typeof LoginSourcesSchema>;

export const LoginImportRequestSchema = Type.Object({
  from: LoginSourceIdSchema,
  /** 已不用（第 6 条，只导登录状态）：网页一律发 false（0.6.0 及以前的 App 要这个字段）；新 App 收下不用。 */
  passwords: Type.Boolean(),
}, STRICT);
export type LoginImportRequest = Static<typeof LoginImportRequestSchema>;

export const LoginImportResultSchema = Type.Object({
  sites: Type.Integer({ minimum: 0 }),
  cookies: Type.Integer({ minimum: 0 }),
  /** 已不用（第 6 条）：网页一律发 passwords: false，App 回 0；网页不显示。 */
  passwords: Type.Integer({ minimum: 0 }),
  /** 解不开或过期了、没搬的 Cookie 条数。 */
  skipped: Type.Integer({ minimum: 0 }),
  /** 没导成时的一句原因（他没允许读「Chrome Safe Storage」、没给完全磁盘访问、Chrome 开着锁着库）；导成了是 null。 */
  problem: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
}, STRICT);
export type LoginImportResult = Static<typeof LoginImportResultSchema>;

export interface PlasticineMacLogins {
  /** 回的是未校验的数据，网页侧按 SiteLoginsSchema 校验后再用。 */
  sites(): Promise<unknown>;
  /** 回 LoginSourcesSchema（未校验）。 */
  sources(): Promise<unknown>;
  /** 回 LoginImportResultSchema（未校验）。读 Chrome 时系统会弹框问能不能读「Chrome Safe Storage」。 */
  import(request: LoginImportRequest): Promise<unknown>;
  /** 退出这个网站：删掉它的 Cookie，回 true。 */
  forget(host: string): Promise<unknown>;
  /** 打开「系统设置 → 隐私与安全性 → 完全磁盘访问」。 */
  openFullDiskAccess(): void;
}
